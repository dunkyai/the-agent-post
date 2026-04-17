import { Router, raw } from "express";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import * as store from "../services/store";
import * as dockerService from "../services/docker";
import { allocatePort } from "../services/port-manager";
import { suspendForBilling, resumeFromBilling } from "../services/billing";
import { registerCaddyRoute } from "./instances";

const router = Router();

interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

function verifyAndParseStripeEvent(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string
): StripeWebhookEvent {
  const parts = signatureHeader.split(",");
  const timestamp = parts.find(p => p.startsWith("t="))?.slice(2);
  const signatures = parts.filter(p => p.startsWith("v1=")).map(p => p.slice(3));

  if (!timestamp || signatures.length === 0) {
    throw new Error("Invalid Stripe-Signature header format");
  }

  // Reject events older than 5 minutes (replay protection)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    throw new Error("Timestamp outside tolerance");
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString()}`)
    .digest("hex");

  const isValid = signatures.some(sig => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, "hex"),
        Buffer.from(sig, "hex")
      );
    } catch {
      return false;
    }
  });

  if (!isValid) {
    throw new Error("Signature mismatch");
  }

  return JSON.parse(rawBody.toString()) as StripeWebhookEvent;
}

async function handleStripeEvent(event: StripeWebhookEvent): Promise<void> {
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const email = obj.customer_email as string | null;
      const customerId = typeof obj.customer === "string" ? obj.customer : null;
      const subscriptionId = typeof obj.subscription === "string" ? obj.subscription : null;

      if (!email || !customerId || !subscriptionId) {
        console.error("[stripe] checkout.session.completed missing data:", { email, customerId, subscriptionId });
        return;
      }

      // Idempotency: skip if instance already exists for this subscription
      const existing = store.getInstanceBySubscription(subscriptionId);
      if (existing) {
        console.log(`[stripe] Instance already exists for subscription ${subscriptionId}: ${existing.id}`);
        return;
      }

      // Detect plan from price ID
      let plan: "standard" | "pro" = "standard";
      const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (proPriceId && stripeKey) {
        try {
          const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
            headers: { Authorization: `Bearer ${stripeKey}` },
          });
          if (subRes.ok) {
            const sub = await subRes.json() as { items: { data: Array<{ price: { id: string } }> } };
            if (sub.items?.data?.[0]?.price?.id === proPriceId) plan = "pro";
          }
        } catch {
          // Default to standard
        }
      }

      const messageLimit = plan === "pro" ? 1000 : 250;
      const id = uuidv4().slice(0, 8);
      const subdomain = id;
      const port = allocatePort();
      const gatewayToken = uuidv4();

      console.log(`[stripe] Provisioning instance ${id} for ${email} (${plan})`);

      // Create DB record
      store.createInstance({
        id,
        email,
        subdomain,
        port,
        status: "provisioning",
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        subscriptionStatus: "active",
        gatewayToken,
        containerId: null,
        plan,
        messageLimit,
      });

      // Set plan/messageLimit (createInstance INSERT doesn't include these columns)
      if (plan === "pro") {
        store.updateInstance(id, { plan: "pro", messageLimit: 1000 });
      }

      // Create Docker container
      const containerId = await dockerService.createContainer({
        name: id,
        port,
        gatewayToken,
        plan,
        messageLimit,
      });

      // Register Caddy route
      registerCaddyRoute(subdomain, port);

      // Update instance to running
      store.updateInstance(id, { containerId, status: "running" });

      console.log(`[stripe] Instance ${id} provisioned for ${email} on port ${port}`);

      // Send welcome email via Resend
      const dashboardUrl = `https://${subdomain}.dunky.ai`;
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        try {
          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "Dunky <noreply@dunky.ai>",
              to: email,
              subject: "Your AI agent is ready — Dunky",
              html: welcomeEmailHtml(dashboardUrl),
            }),
          });
          if (!emailRes.ok) {
            const errBody = await emailRes.text().catch(() => "");
            console.error(`[stripe] Welcome email failed for ${email} (${emailRes.status}):`, errBody);
          } else {
            console.log(`[stripe] Welcome email sent to ${email}`);
          }
        } catch (emailErr) {
          console.error(`[stripe] Welcome email error for ${email}:`, emailErr);
        }
      } else {
        console.error(`[stripe] RESEND_API_KEY not set — welcome email NOT sent to ${email}`);
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscriptionId = obj.id as string;
      const status = obj.status as string;
      const instance = store.getInstanceBySubscription(subscriptionId);
      if (!instance) {
        console.warn(`[stripe] Event for unknown subscription: ${subscriptionId}`);
        return;
      }

      console.log(`[stripe] Subscription ${subscriptionId} → ${status} (instance ${instance.id})`);

      // Detect plan change based on price ID
      const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
      const standardPriceId = process.env.STRIPE_PRICE_ID;
      const items = obj.items as { data?: Array<{ price?: { id?: string } }> } | undefined;
      const currentPriceId = items?.data?.[0]?.price?.id;

      if (currentPriceId && proPriceId && currentPriceId === proPriceId) {
        console.log(`[stripe] Instance ${instance.id} upgraded to Pro`);
        store.updateInstance(instance.id, { plan: "pro", messageLimit: 1000 });
      } else if (currentPriceId && standardPriceId && currentPriceId === standardPriceId) {
        if (instance.plan !== "standard") {
          console.log(`[stripe] Instance ${instance.id} downgraded to Standard`);
          store.updateInstance(instance.id, { plan: "standard", messageLimit: 250 });
        }
      }

      if (status === "active" || status === "trialing") {
        store.updateInstance(instance.id, { subscriptionStatus: "active" });
        // Resume if it was suspended for billing
        if (instance.status === "suspended" && instance.subscriptionStatus !== "active") {
          await resumeFromBilling(instance);
        }
      } else if (status === "past_due" || status === "unpaid" || status === "canceled") {
        store.updateInstance(instance.id, {
          subscriptionStatus: status as "past_due" | "unpaid" | "canceled",
        });
        await suspendForBilling(instance);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscriptionId = obj.id as string;
      const instance = store.getInstanceBySubscription(subscriptionId);
      if (!instance) return;

      console.log(`[stripe] Subscription deleted for instance ${instance.id}`);
      store.updateInstance(instance.id, { subscriptionStatus: "canceled" });
      await suspendForBilling(instance);
      break;
    }

    case "invoice.payment_failed": {
      const subscriptionId = obj.subscription as string;
      if (!subscriptionId) return;
      const instance = store.getInstanceBySubscription(subscriptionId);
      if (!instance) return;

      console.log(`[stripe] Payment failed for instance ${instance.id}`);
      store.updateInstance(instance.id, { subscriptionStatus: "past_due" });
      await suspendForBilling(instance);
      break;
    }

    case "invoice.paid": {
      const subscriptionId = obj.subscription as string;
      if (!subscriptionId) return;
      const instance = store.getInstanceBySubscription(subscriptionId);
      if (!instance) return;

      console.log(`[stripe] Payment succeeded for instance ${instance.id}`);
      const wasBillingSuspended =
        instance.status === "suspended" && instance.subscriptionStatus !== "active";

      store.updateInstance(instance.id, { subscriptionStatus: "active" });

      if (wasBillingSuspended) {
        await resumeFromBilling(instance);
      }
      break;
    }

    default:
      break;
  }
}

// POST /stripe/webhooks
router.post("/", raw({ type: "application/json" }), async (req, res) => {
  const rawBody = req.body as Buffer;
  const signature = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    res.status(400).send("Missing signature or webhook secret");
    return;
  }

  let event: StripeWebhookEvent;
  try {
    event = verifyAndParseStripeEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe] Signature verification failed:", err instanceof Error ? err.message : err);
    res.status(400).send("Invalid signature");
    return;
  }

  // Respond 200 immediately (Stripe retries on non-2xx)
  res.sendStatus(200);

  try {
    await handleStripeEvent(event);
  } catch (err) {
    console.error("[stripe] Webhook processing error:", err instanceof Error ? err.message : err);
  }
});

function welcomeEmailHtml(dashboardUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAF7F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:#1A1A2E;margin:0 0 8px;">Your AI agent is live</h1>
    <p style="color:#4A4A5A;font-size:15px;line-height:1.6;margin:0 0 24px;">Your Dunky AI agent has been provisioned and is ready to go.</p>
    <div style="background:#F3E8FF;border:1px solid #D8B4FE;border-radius:8px;padding:20px;margin:0 0 24px;">
      <p style="font-weight:700;color:#6B21A8;font-size:14px;margin:0 0 12px;">Dashboard</p>
      <a href="${dashboardUrl}" style="color:#6B21A8;font-size:15px;word-break:break-all;">${dashboardUrl}</a>
    </div>
    <h2 style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#1A1A2E;margin:0 0 12px;">Get started</h2>
    <ol style="color:#4A4A5A;font-size:14px;line-height:1.8;padding-left:20px;margin:0 0 24px;">
      <li>Open your <a href="${dashboardUrl}" style="color:#6B21A8;">dashboard</a> — you'll receive a magic link to sign in</li>
      <li>Connect your integrations (Gmail, Slack, Google Docs, and more)</li>
      <li>Start chatting with your AI agent</li>
    </ol>
    <p style="color:#4A4A5A;font-size:14px;line-height:1.6;margin:0 0 24px;">Once connected, your AI agent will respond to messages automatically. You can customize its behavior, tools, and personality from the dashboard.</p>
    <hr style="border:none;border-top:2px double #E5E0D8;margin:24px 0;">
    <p style="color:#999;font-size:12px;text-align:center;margin:0;">Dunky &middot; <a href="https://dunky.ai" style="color:#6B21A8;">dunky.ai</a></p>
  </div>
</body>
</html>`;
}

export default router;
