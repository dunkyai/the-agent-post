import { processMessage } from "./ai";

interface WhatsAppMessage {
  from: string;
  text?: { body: string };
  type: string;
}

interface WhatsAppWebhookBody {
  object: string;
  entry?: {
    changes?: {
      value?: {
        messages?: WhatsAppMessage[];
        metadata?: { phone_number_id: string };
      };
    }[];
  }[];
}

export async function handleWhatsAppWebhook(
  body: WhatsAppWebhookBody,
  phoneNumberId: string,
  accessToken: string
): Promise<void> {
  if (body.object !== "whatsapp_business_account") return;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const messages = change.value?.messages || [];
      for (const msg of messages) {
        if (msg.type !== "text" || !msg.text?.body) continue;

        const from = msg.from;
        const text = msg.text.body;

        try {
          const reply = await processMessage("whatsapp", from, text);
          await sendWhatsAppMessage(phoneNumberId, accessToken, from, reply);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("WhatsApp error:", message);
        }
      }
    }
  }
}

async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string
): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error("WhatsApp send error:", body);
  }
}
