import { Router } from "express";
import * as store from "../services/store";

const router = Router();

// GET /auth/magic-link?token=xxx — user clicks link from email
router.get("/magic-link", (req, res) => {
  const { token } = req.query;

  if (!token || typeof token !== "string") {
    res.status(400).send(errorPage("Invalid link", "This sign-in link is invalid."));
    return;
  }

  const result = store.consumeMagicLinkToken(token);
  if (!result) {
    res.status(410).send(errorPage("Link expired or invalid", "This sign-in link has already been used or has expired. To get a new one, go to your dashboard URL and click \"Sign in\" — a fresh magic link will be sent to your email."));
    return;
  }

  const instance = store.getInstance(result.instanceId);
  if (!instance) {
    res.status(404).send(errorPage("Not found", "The associated instance could not be found."));
    return;
  }

  const callbackUrl = `https://${instance.subdomain}.dunky.ai/login/callback?code=${result.sessionCode}`;
  res.redirect(302, callbackUrl);
});

// POST /auth/login — public endpoint: user enters email, gets magic link for their instance
router.post("/login", async (req, res) => {
  const email = (req.body?.email || "").trim().toLowerCase();

  if (!email) {
    res.status(400).json({ message: "Email is required" });
    return;
  }

  // Always return success to prevent email enumeration
  const successMsg = "If you have an account, you'll receive a sign-in link shortly.";

  try {
    const instances = store.getInstancesByEmail(email);
    if (instances.length === 0) {
      res.json({ message: successMsg });
      return;
    }

    // Rate limit: max 3 magic links per email per 15 minutes
    const recentCount = store.countRecentMagicLinksForInstance(instances[0].id, 15 * 60 * 1000);
    if (recentCount >= 3) {
      res.json({ message: successMsg });
      return;
    }

    // Send magic link for each instance (usually just one)
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      console.error("[auth/login] RESEND_API_KEY not set");
      res.json({ message: successMsg });
      return;
    }

    for (const instance of instances) {
      const magicToken = store.createMagicLinkToken(instance.id);
      const magicLink = `https://api.dunky.ai/auth/magic-link?token=${magicToken}`;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Dunky <noreply@dunky.ai>",
          reply_to: "elizabeth@hustlefundvc.com",
          to: instance.email,
          subject: "Sign in to your Dunky dashboard",
          html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #1a1a1a; font-size: 20px; margin-bottom: 16px;">Sign in to your dashboard</h2>
  <p style="color: #444; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">Click the button below to sign in. This link can only be used once and expires in 24 hours.</p>
  <a href="${magicLink}" style="display: inline-block; background: #6c5ce7; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 15px; font-weight: 500;">Sign in to Dunky</a>
  <p style="color: #888; font-size: 13px; margin-top: 32px; line-height: 1.5;">If you didn't request this link, you can safely ignore this email.</p>
  <p style="color: #bbb; font-size: 12px; margin-top: 24px;">— Dunky</p>
</div>`,
        }),
      });
      console.log(`[auth/login] Magic link sent to ${instance.email} for instance ${instance.id}`);
    }
  } catch (err) {
    console.error("[auth/login] Error:", err instanceof Error ? err.message : err);
  }

  res.json({ message: successMsg });
});

function errorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — OpenClaw</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #e0e0e0; }
    .card { max-width: 420px; padding: 40px; text-align: center; }
    h1 { font-size: 24px; margin-bottom: 12px; }
    p { color: #999; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export default router;
