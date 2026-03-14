import { Router, Request, Response } from "express";
import { getIntegration } from "../services/db";
import { decrypt } from "../services/encryption";

const router = Router();

// Email (LobsterMail) webhook — future enhancement for push-based delivery
router.post("/webhook/email", async (req: Request, res: Response) => {
  const integration = getIntegration("email");
  if (!integration || integration.status !== "connected") {
    res.sendStatus(200);
    return;
  }

  try {
    const config = JSON.parse(decrypt(integration.config));
    const { processMessage } = require("../services/ai");
    const events = Array.isArray(req.body) ? req.body : [req.body];

    for (const event of events) {
      if (event.type !== "email.received") continue;
      const email = event.data || event;
      const sender = email.from || email.sender || "unknown";
      const subject = email.subject || "";
      const body = email.body?.text || email.body?.html || email.body || "";
      const text = subject ? `Subject: ${subject}\n\n${body}` : body;
      if (!text.trim()) continue;

      const reply = await processMessage("email", sender, text);

      // Attempt reply (will fail gracefully on Tier 0)
      try {
        const sendRes = await fetch("https://api.lobstermail.ai/v1/emails/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.api_token}`,
          },
          body: JSON.stringify({
            from: config.email_address,
            to: [sender],
            subject: subject ? `Re: ${subject.replace(/^Re:\s*/i, "")}` : "Re: your message",
            body: { text: reply },
          }),
        });
        if (sendRes.status === 403) {
          console.log("Email webhook reply skipped (Tier 0)");
        } else if (!sendRes.ok) {
          console.error(`Email webhook send error (${sendRes.status})`);
        }
      } catch (err: unknown) {
        console.error("Email webhook send error:", err instanceof Error ? err.message : err);
      }
    }
  } catch (err: unknown) {
    console.error("Email webhook error:", err instanceof Error ? err.message : err);
  }

  res.sendStatus(200);
});

export default router;
