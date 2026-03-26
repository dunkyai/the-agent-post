import { Router, raw } from "express";
import crypto from "crypto";
import * as store from "../services/store";
import { suspendForBilling, resumeFromBilling } from "../services/billing";

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
    case "customer.subscription.updated": {
      const subscriptionId = obj.id as string;
      const status = obj.status as string;
      const instance = store.getInstanceBySubscription(subscriptionId);
      if (!instance) {
        console.warn(`[stripe] Event for unknown subscription: ${subscriptionId}`);
        return;
      }

      console.log(`[stripe] Subscription ${subscriptionId} → ${status} (instance ${instance.id})`);

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

export default router;
