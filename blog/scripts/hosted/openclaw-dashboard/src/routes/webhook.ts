import { Router, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { getIntegration, upsertIntegration } from "../services/db";
import { encrypt, decrypt } from "../services/encryption";
import { startGoogle } from "../services/google";
import { startSlack, handleSlackEvent } from "../services/slack";
import { isEmailAllowed, sanitizeEmailContent } from "../services/email";
import { startAirtable } from "../services/airtable";
import { startNotion } from "../services/notion";

const router = Router();

// --- HMAC signature verification ---

function verifyLobsterMailSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  if (expected.length !== signatureHeader.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

// Email (LobsterMail) webhook
router.post("/webhook/email", async (req: Request, res: Response) => {
  // 1. Require GATEWAY_TOKEN (same as Slack/Google webhooks)
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== process.env.GATEWAY_TOKEN) {
    res.sendStatus(401);
    return;
  }

  const integration = getIntegration("email");
  if (!integration || integration.status !== "connected") {
    res.sendStatus(200);
    return;
  }

  let config: Record<string, any>;
  try {
    config = JSON.parse(decrypt(integration.config));
  } catch {
    console.error("Email webhook: failed to decrypt config");
    res.sendStatus(200);
    return;
  }

  // 2. Verify HMAC signature if webhook secret is also configured
  if (config.webhook_secret) {
    const signature = req.headers["x-lobstermail-signature"] as string | undefined;
    const rawBody = (req as any).rawBody as Buffer | undefined;

    if (!signature || !rawBody) {
      console.warn("Email webhook rejected: missing signature or raw body");
      res.sendStatus(401);
      return;
    }

    if (!verifyLobsterMailSignature(rawBody, signature, config.webhook_secret)) {
      console.warn("Email webhook rejected: invalid signature");
      res.sendStatus(401);
      return;
    }
  }

  try {
    const { processMessage } = require("../services/ai");
    const events = Array.isArray(req.body) ? req.body : [req.body];

    for (const event of events) {
      if (event.type !== "email.received") continue;
      const email = event.data || event;

      // 2. Validate payload structure
      const sender = email.from || email.sender;
      const subject = email.subject;
      const rawBody = email.body?.text || email.body?.html || email.body;

      if (!sender || typeof sender !== "string") {
        console.warn("Email webhook: missing or invalid 'from' field");
        continue;
      }
      if (subject !== undefined && typeof subject !== "string") {
        console.warn("Email webhook: invalid 'subject' field");
        continue;
      }
      if (!rawBody || typeof rawBody !== "string") {
        console.warn("Email webhook: missing or invalid body");
        continue;
      }

      // 3. Check sender allowlist
      if (!isEmailAllowed(sender)) {
        console.log(`Webhook email from ${sender} filtered out`);
        continue;
      }

      // 4. Sanitize content before AI processing
      const bodyText = sanitizeEmailContent(rawBody);
      const text = subject ? `Subject: ${subject}\n\n${bodyText}` : bodyText;
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

    const typeKey = `google:${google_email}`;
    const config = encrypt(JSON.stringify(configData));
    upsertIntegration(typeKey, config, "connected");
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

// Airtable OAuth — provisioning API delivers tokens here after consent
router.post("/webhook/airtable/tokens", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== process.env.GATEWAY_TOKEN) {
    res.sendStatus(401);
    return;
  }

  try {
    const { access_token, refresh_token, expires_in } = req.body;

    const configData = {
      access_token,
      refresh_token,
      token_expiry: new Date(Date.now() + expires_in * 1000).toISOString(),
    };

    const config = encrypt(JSON.stringify(configData));
    upsertIntegration("airtable", config, "connected");
    startAirtable(configData);

    console.log("Airtable connected via OAuth");
    res.json({ ok: true });
  } catch (err: unknown) {
    console.error("Airtable token delivery error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Failed to store Airtable tokens" });
  }
});

// Notion OAuth — provisioning API delivers tokens here after consent
router.post("/webhook/notion/tokens", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== process.env.GATEWAY_TOKEN) {
    res.sendStatus(401);
    return;
  }

  try {
    const { access_token, workspace_name, workspace_id, bot_id } = req.body;

    const configData = { access_token, workspace_name, workspace_id, bot_id };
    const config = encrypt(JSON.stringify(configData));
    upsertIntegration("notion", config, "connected");
    startNotion(configData);

    console.log(`Notion connected (workspace: ${workspace_name})`);
    res.json({ ok: true });
  } catch (err: unknown) {
    console.error("Notion token delivery error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Failed to store Notion tokens" });
  }
});

export default router;
