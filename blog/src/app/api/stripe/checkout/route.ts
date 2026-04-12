import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://dunky.ai",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json(
      { error: "Valid email is required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 500 }
    );
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

    return NextResponse.json({ url: session.url }, { headers: CORS_HEADERS });
  } catch (err: unknown) {
    console.error("Stripe checkout error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to create checkout",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
