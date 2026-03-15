import { Router, Request, Response } from "express";
import { getIntegration, upsertIntegration } from "../services/db";
import { encrypt, decrypt } from "../services/encryption";
import { startGoogle } from "../services/google";
import { startSlack, handleSlackEvent } from "../services/slack";

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

// Google OAuth — provisioning API delivers tokens here after consent
router.post("/webhook/google/tokens", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== process.env.GATEWAY_TOKEN) {
    res.sendStatus(401);
    return;
  }

  try {
    const { access_token, refresh_token, expires_in, services, google_email } = req.body;

    const configData = {
      access_token,
      refresh_token,
      token_expiry: new Date(Date.now() + expires_in * 1000).toISOString(),
      services,
      google_email,
    };

    const config = encrypt(JSON.stringify(configData));
    upsertIntegration("google", config, "connected");
    startGoogle(configData);

    console.log(`Google connected for ${google_email} with services: ${services.join(", ")}`);
    res.json({ ok: true });
  } catch (err: unknown) {
    console.error("Google token delivery error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Failed to store Google tokens" });
  }
});

// Slack OAuth — provisioning API delivers tokens here after consent
router.post("/webhook/slack/tokens", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== process.env.GATEWAY_TOKEN) {
    res.sendStatus(401);
    return;
  }

  try {
    const { bot_token, bot_user_id, team_id, team_name } = req.body;

    const configData = { bot_token, bot_user_id, team_id, team_name };
    const config = encrypt(JSON.stringify(configData));
    upsertIntegration("slack", config, "connected");
    startSlack(configData);

    console.log(`Slack connected for team ${team_name} (${team_id})`);
    res.json({ ok: true });
  } catch (err: unknown) {
    console.error("Slack token delivery error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Failed to store Slack tokens" });
  }
});

// Slack Events — gateway forwards events here
router.post("/webhook/slack/events", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== process.env.GATEWAY_TOKEN) {
    res.sendStatus(401);
    return;
  }

  // Respond immediately
  res.sendStatus(200);

  // Process asynchronously
  const { event, event_id } = req.body;
  try {
    await handleSlackEvent(event, event_id);
  } catch (err: unknown) {
    console.error("Slack event handling error:", err instanceof Error ? err.message : err);
  }
});

export default router;
