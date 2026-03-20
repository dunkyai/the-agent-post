import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { requireAuth } from "./middleware/auth";
import { getDb, getIntegration, getGoogleIntegrations, upsertIntegration, deleteIntegration, getSetting } from "./services/db";
import { decrypt } from "./services/encryption";

// Routes
import loginRouter from "./routes/login";
import gettingStartedRouter from "./routes/getting-started";
import settingsRouter from "./routes/settings";
import integrationsRouter from "./routes/integrations";
import chatRouter from "./routes/chat";
import healthRouter from "./routes/health";
import webhookRouter from "./routes/webhook";
import jobsRouter from "./routes/jobs";
import bugReportRouter from "./routes/bug-report";

const app = express();
app.disable("x-powered-by");
const PORT = parseInt(process.env.PORT || "3000", 10);

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Middleware — capture raw body on webhook routes for signature verification
app.use(express.json({
  verify: (req: any, _res, buf) => {
    if (req.url?.startsWith("/webhook/")) {
      req.rawBody = buf;
    }
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Security headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// Auth middleware (skips /login, /health, /webhook/*)
app.use(requireAuth);

// Credit warning — available in all templates via res.locals
app.use((_req, res, next) => {
  res.locals.creditWarning = getSetting("credit_warning") || "";
  next();
});

// Routes
app.use(loginRouter);
app.use(gettingStartedRouter);
app.use(settingsRouter);
app.use(integrationsRouter);
app.use(chatRouter);
app.use(healthRouter);
app.use(webhookRouter);
app.use(jobsRouter);
app.use(bugReportRouter);

// Root redirect
app.get("/", (_req, res) => {
  res.redirect("/getting-started");
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

  // Google — migrate legacy type='google' to google:<email>, then reconnect all
  try {
    const legacyGoogle = getIntegration("google");
    if (legacyGoogle && legacyGoogle.status === "connected") {
      try {
        const config = JSON.parse(decrypt(legacyGoogle.config));
        if (config.google_email) {
          const newKey = `google:${config.google_email}`;
          upsertIntegration(newKey, legacyGoogle.config, legacyGoogle.status, legacyGoogle.error_message || undefined);
          deleteIntegration("google");
          console.log(`Migrated legacy Google integration to ${newKey}`);
        }
      } catch (migErr: unknown) {
        console.error("Failed to migrate legacy Google:", migErr instanceof Error ? migErr.message : migErr);
      }
    }
  } catch {}

  // Supabase
  try {
    const supabase = getIntegration("supabase");
    if (supabase && supabase.status === "connected") {
      const config = JSON.parse(decrypt(supabase.config));
      const { startSupabase } = require("./services/supabase");
      startSupabase({ projectUrl: config.project_url, apiKey: config.api_key, permissions: config.permissions });
      console.log("Supabase reconnected");
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Supabase:", err instanceof Error ? err.message : err);
  }

  // Airtable
  try {
    const airtable = getIntegration("airtable");
    if (airtable && airtable.status === "connected") {
      const config = JSON.parse(decrypt(airtable.config));
      const { startAirtable } = require("./services/airtable");
      startAirtable(config);
      console.log("Airtable reconnected");
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Airtable:", err instanceof Error ? err.message : err);
  }

  // Notion
  try {
    const notion = getIntegration("notion");
    if (notion && notion.status === "connected") {
      const config = JSON.parse(decrypt(notion.config));
      const { startNotion } = require("./services/notion");
      startNotion(config);
      console.log(`Notion reconnected (workspace: ${config.workspace_name})`);
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Notion:", err instanceof Error ? err.message : err);
  }

  // Buffer
  try {
    const buffer = getIntegration("buffer");
    if (buffer && buffer.status === "connected") {
      const config = JSON.parse(decrypt(buffer.config));
      const { startBuffer } = require("./services/buffer");
      startBuffer(config);
      console.log(`Buffer reconnected${config.organization_name ? ` (${config.organization_name})` : ""}`);
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Buffer:", err instanceof Error ? err.message : err);
  }

  // Luma
  try {
    const luma = getIntegration("luma");
    if (luma && luma.status === "connected") {
      const config = JSON.parse(decrypt(luma.config));
      const { startLuma } = require("./services/luma");
      startLuma(config);
      console.log(`Luma reconnected${config.user_name ? ` (${config.user_name})` : ""}`);
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Luma:", err instanceof Error ? err.message : err);
  }

  try {
    const googleRows = getGoogleIntegrations();
    for (const row of googleRows) {
      if (row.status !== "connected") continue;
      try {
        const config = JSON.parse(decrypt(row.config));
        const { startGoogle } = require("./services/google");
        startGoogle(config);
        console.log(`Google reconnected (${config.google_email})`);
      } catch (err: unknown) {
        console.error(`Failed to reconnect Google (${row.type}):`, err instanceof Error ? err.message : err);
      }
    }
    // Start Gmail polling if enabled
    const { startGmailPolling } = require("./services/google");
    startGmailPolling();
  } catch (err: unknown) {
    console.error("Failed to reconnect Google accounts:", err instanceof Error ? err.message : err);
  }
}

start();
