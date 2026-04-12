import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

function corsJson(data: unknown, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Access-Control-Allow-Origin", "https://dunky.ai");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export async function OPTIONS() {
  const res = new NextResponse(null, { status: 204 });
  res.headers.set("Access-Control-Allow-Origin", "https://dunky.ai");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return corsJson({ error: "Valid email is required" }, 400);
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return corsJson({ error: "Stripe not configured" }, 500);
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: "https://dunky.ai/success",
      cancel_url: "https://dunky.ai",
    });

    return corsJson({ url: session.url });
  } catch (err: unknown) {
    console.error("Stripe checkout error:", err);
    return corsJson(
      { error: err instanceof Error ? err.message : "Failed to create checkout" },
      500
    );
  }
}
