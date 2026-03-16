import { Router, Request, Response } from "express";
import { createSession, destroySession } from "../middleware/auth";

const PROVISIONING_URL = process.env.PROVISIONING_URL || "http://localhost:3500";
const INSTANCE_ID = process.env.INSTANCE_ID || "";

const router = Router();

// Rate limiting for magic link requests: max 3 per IP per 15 minutes
const magicLinkAttempts = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 3;

  const attempts = (magicLinkAttempts.get(ip) || []).filter((t) => now - t < windowMs);
  magicLinkAttempts.set(ip, attempts);

  if (attempts.length >= maxAttempts) return true;
  attempts.push(now);
  return false;
}

// Clean up stale entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  for (const [ip, attempts] of magicLinkAttempts) {
    const recent = attempts.filter((t) => now - t < windowMs);
    if (recent.length === 0) magicLinkAttempts.delete(ip);
    else magicLinkAttempts.set(ip, recent);
  }
}, 30 * 60 * 1000);

router.get("/login", (req: Request, res: Response) => {
  const sent = req.query.sent === "1";
  const error = typeof req.query.error === "string" ? req.query.error : null;
  res.render("login", { error, sent });
});

// POST /login/magic-link — request a magic link via provisioning
router.post("/login/magic-link", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email || !email.trim()) {
      res.redirect(303, "/login?error=Please+enter+your+email+address");
      return;
    }

    // Rate limit by IP
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (isRateLimited(ip)) {
      // Still show "check your email" to prevent enumeration
      res.redirect(303, "/login?sent=1");
      return;
    }

    const response = await fetch(`${PROVISIONING_URL}/instances/${INSTANCE_ID}/magic-link`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GATEWAY_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: email.trim() }),
    });

    if (!response.ok) {
      console.error("Magic link request failed:", response.status, await response.text());
    }

    // Always redirect to "check your email" state to prevent enumeration
    res.redirect(303, "/login?sent=1");
  } catch (err) {
    console.error("Magic link error:", err);
    res.redirect(303, "/login?error=Something+went+wrong.+Please+try+again.");
  }
});

// GET /login/callback?code=xxx — verify session code from magic link
router.get("/login/callback", async (req: Request, res: Response) => {
  try {
    const { code } = req.query;
    if (!code || typeof code !== "string") {
      res.redirect(303, "/login?error=Invalid+sign-in+link");
      return;
    }

    const response = await fetch(`${PROVISIONING_URL}/instances/${INSTANCE_ID}/verify-session-code`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GATEWAY_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });

    if (!response.ok) {
      res.redirect(303, "/login?error=Sign-in+link+expired+or+invalid.+Please+request+a+new+one.");
      return;
    }

    createSession(res);
    res.redirect(303, "/settings");
  } catch (err) {
    console.error("Callback error:", err);
    res.redirect(303, "/login?error=Something+went+wrong.+Please+try+again.");
  }
});

router.post("/logout", (req: Request, res: Response) => {
  destroySession(req, res);
  res.redirect(303, "/login");
});

export default router;
