import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: "Valid email is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.RESEND_API_KEY;
    const segmentId = process.env.RESEND_SEGMENT_ID;

    if (!apiKey || !segmentId) {
      console.error("Missing RESEND_API_KEY or RESEND_SEGMENT_ID env var");
      return NextResponse.json(
        { error: "Newsletter not configured" },
        { status: 500 }
      );
    }

    const res = await fetch("https://api.resend.com/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        segments: [{ id: segmentId }],
        unsubscribed: false,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(`Resend API error (${res.status}):`, JSON.stringify(data));
      return NextResponse.json(
        { error: data.message || "Failed to subscribe" },
        { status: res.status }
      );
    }

    return NextResponse.json({ success: true, id: data.id });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to subscribe";
    console.error("Subscribe error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
