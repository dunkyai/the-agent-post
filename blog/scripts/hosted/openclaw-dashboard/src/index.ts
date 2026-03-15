import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { requireAuth } from "./middleware/auth";
import { getDb, getIntegration } from "./services/db";
import { decrypt } from "./services/encryption";

// Routes
import loginRouter from "./routes/login";
import settingsRouter from "./routes/settings";
import integrationsRouter from "./routes/integrations";
import chatRouter from "./routes/chat";
import healthRouter from "./routes/health";
import webhookRouter from "./routes/webhook";
import jobsRouter from "./routes/jobs";

const app = express();
app.disable("x-powered-by");
const PORT = parseInt(process.env.PORT || "3000", 10);

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// Auth middleware (skips /login, /health, /webhook/*)
app.use(requireAuth);

// Routes
app.use(loginRouter);
app.use(settingsRouter);
app.use(integrationsRouter);
app.use(chatRouter);
app.use(healthRouter);
app.use(webhookRouter);
app.use(jobsRouter);

// Root redirect
app.get("/", (_req, res) => {
  res.redirect("/settings");
});

// Initialize database and start server
function start() {
  if (!process.env.GATEWAY_TOKEN) {
    console.error("GATEWAY_TOKEN environment variable is required");
    process.exit(1);
  }

  // Initialize DB
  getDb();
  console.log("Database initialized");

  // Auto-reconnect integrations
  reconnectIntegrations();

  // Start job scheduler
  const { startScheduler } = require("./services/scheduler");
  startScheduler();

  app.listen(PORT, () => {
    console.log(`OpenClaw dashboard running on port ${PORT}`);
  });
}

async function reconnectIntegrations() {
  // Telegram
  try {
    const telegram = getIntegration("telegram");
    if (telegram && telegram.status === "connected") {
      const config = JSON.parse(decrypt(telegram.config));
      const { startTelegram } = require("./services/telegram");
      startTelegram(config.bot_token);
      console.log("Telegram bot reconnected");
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Telegram:", err instanceof Error ? err.message : err);
  }

  // Slack
  try {
    const slack = getIntegration("slack");
    if (slack && slack.status === "connected") {
      const config = JSON.parse(decrypt(slack.config));
      const { startSlack } = require("./services/slack");
      if (config.bot_token && config.bot_user_id && config.team_id) {
        startSlack(config);
        console.log(`Slack reconnected (team: ${config.team_name})`);
      } else {
        // Legacy Socket Mode config — user needs to reconnect via OAuth
        const { upsertIntegration } = require("./services/db");
        upsertIntegration("slack", "{}", "disconnected");
        console.log("Slack: legacy config detected, marked disconnected (user must reconnect via OAuth)");
      }
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Slack:", err instanceof Error ? err.message : err);
  }

  // Email (LobsterMail)
  try {
    const email = getIntegration("email");
    if (email && email.status === "connected") {
      const config = JSON.parse(decrypt(email.config));
      const { startEmail } = require("./services/email");
      startEmail({
        apiToken: config.api_token,
        inboxId: config.inbox_id,
        emailAddress: config.email_address,
      });
      console.log("Email polling reconnected");
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Email:", err instanceof Error ? err.message : err);
  }

  // Google
  try {
    const google = getIntegration("google");
    if (google && google.status === "connected") {
      const config = JSON.parse(decrypt(google.config));
      const { startGoogle } = require("./services/google");
      startGoogle(config);
      console.log(`Google reconnected (${config.google_email})`);
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Google:", err instanceof Error ? err.message : err);
  }
}

start();
