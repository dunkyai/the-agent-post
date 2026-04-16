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
