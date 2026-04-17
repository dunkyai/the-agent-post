import express from "express";
import cors from "cors";
import { authMiddleware } from "./middleware/auth";
import instancesRouter from "./routes/instances";
import healthRouter from "./routes/health";
import oauthRouter from "./routes/oauth";
import authRouter from "./routes/auth";
import slackEventsRouter from "./routes/slack-events";
import stripeWebhooksRouter from "./routes/stripe-webhooks";
import { ensureBrowserService } from "./services/browser";
import analyticsRouter from "./routes/analytics";
import { cleanExpiredTokens } from "./services/store";
import { enforceBillingActions } from "./services/billing";

const app = express();
app.disable("x-powered-by");
const PORT = parseInt(process.env.PORT || "3500", 10);

app.use(cors());

// Security headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// Slack events must be mounted before express.json() — needs raw body for signature verification
app.use("/slack/events", slackEventsRouter);

// Stripe webhooks must be mounted before express.json() — needs raw body for signature verification
app.use("/stripe/webhooks", stripeWebhooksRouter);

app.use(express.json());

// Public health check
app.use(healthRouter);

// Public OAuth callbacks (Google/Slack redirect here, no auth needed)
app.use("/oauth", oauthRouter);

// Public auth routes (magic link callback)
app.use("/auth", authRouter);

// Public Stripe checkout (creates checkout session, no auth needed)
app.post("/stripe/checkout", async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Valid email is required" });
    return;
  }
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!secretKey || !priceId) {
    res.status(500).json({ error: "Stripe not configured" });
    return;
  }
  try {
    const stripe = (await import("stripe")).default;
    const client = new stripe(secretKey);
    const session = await client.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: "https://dunky.ai/success",
      cancel_url: "https://dunky.ai",
    });
    res.json({ url: session.url });
  } catch (err: unknown) {
    console.error("Stripe checkout error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create checkout" });
  }
});

// Protected routes
app.use("/instances", authMiddleware, instancesRouter);

// Admin analytics (self-authenticated via query param)
app.use(analyticsRouter);

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Provisioning API running on 0.0.0.0:${PORT}`);

  // Clean expired magic link tokens every hour
  setInterval(() => {
    try {
      const cleaned = cleanExpiredTokens();
      if (cleaned > 0) console.log(`Cleaned ${cleaned} expired magic link tokens`);
    } catch (err) {
      console.error("Token cleanup error:", err);
    }
  }, 60 * 60 * 1000);

  // Enforce billing actions every 12 hours (safety net for missed webhooks)
  setInterval(async () => {
    try {
      await enforceBillingActions();
    } catch (err) {
      console.error("Billing enforcement error:", err);
    }
  }, 12 * 60 * 60 * 1000);

  // Run billing enforcement once at startup (catch up on missed actions)
  enforceBillingActions().catch(err => {
    console.error("Startup billing enforcement error:", err);
  });

  // Start browser service container if not already running
  try {
    await ensureBrowserService();
  } catch (err) {
    console.error("Failed to start browser service:", err instanceof Error ? err.message : err);
    console.error("Browser tools will not be available until the browser service is running");
  }
});
