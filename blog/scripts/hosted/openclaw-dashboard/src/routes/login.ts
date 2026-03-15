import { Router, Request, Response } from "express";
import { createSession, destroySession } from "../middleware/auth";

const PROVISIONING_URL = process.env.PROVISIONING_URL || "http://localhost:3500";
const INSTANCE_ID = process.env.INSTANCE_ID || "";

const router = Router();

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
