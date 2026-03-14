import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import {
  createInstance,
  deleteInstance,
  getInstanceBySubscription,
  suspendInstance,
  resumeInstance,
} from "@/lib/provisioning";
import { welcomeEmail } from "@/lib/email-templates";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Not configured" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err: unknown) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const email = session.customer_email;
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;

        if (!email || !customerId || !subscriptionId) {
          console.error("Missing session data:", {
            email,
            customerId,
            subscriptionId,
          });
          break;
        }

        const instance = await createInstance({
          email,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
        });

        const dashboardUrl = `https://${instance.subdomain}.agents.theagentpost.co`;
        const template = welcomeEmail({
          dashboardUrl,
          gatewayToken: instance.gatewayToken,
        });

        const resendKey = process.env.RESEND_API_KEY;
        if (resendKey) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "The Agent Post <noreply@theagentpost.co>",
              to: email,
              subject: template.subject,
              html: template.html,
            }),
          });
        }

        console.log(`Instance created for ${email}: ${instance.id}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const instance = await getInstanceBySubscription(subscription.id);
        if (instance) {
          await deleteInstance(instance.id);
          console.log(`Instance deleted: ${instance.id}`);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const instance = await getInstanceBySubscription(subscription.id);
        if (!instance) break;

        if (
          subscription.status === "past_due" ||
          subscription.status === "unpaid"
        ) {
          await suspendInstance(instance.id);
          console.log(`Instance suspended: ${instance.id}`);
        } else if (
          subscription.status === "active" &&
          instance.status === "suspended"
        ) {
          await resumeInstance(instance.id);
          console.log(`Instance resumed: ${instance.id}`);
        }
        break;
      }
    }
  } catch (err) {
    console.error(`Webhook handler error for ${event.type}:`, err);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
