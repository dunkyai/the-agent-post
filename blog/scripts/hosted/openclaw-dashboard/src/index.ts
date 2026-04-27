import app from "./app";
import { getDb, getIntegration, getGoogleIntegrations, upsertIntegration, deleteIntegration } from "./services/db";
import { decrypt } from "./services/encryption";

const PORT = parseInt(process.env.PORT || "3000", 10);

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

  // Twitter
  try {
    const twitter = getIntegration("twitter");
    if (twitter && twitter.status === "connected") {
      const config = JSON.parse(decrypt(twitter.config));
      const { startTwitter } = require("./services/twitter");
      startTwitter(config);
      console.log(`Twitter reconnected${config.username ? ` (@${config.username})` : ""}`);
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Twitter:", err instanceof Error ? err.message : err);
  }

  // Beehiiv
  try {
    const beehiiv = getIntegration("beehiiv");
    if (beehiiv && beehiiv.status === "connected") {
      const config = JSON.parse(decrypt(beehiiv.config));
      const { startBeehiiv } = require("./services/beehiiv");
      startBeehiiv(config);
      console.log(`Beehiiv reconnected${config.publication_name ? ` (${config.publication_name})` : ""}`);
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Beehiiv:", err instanceof Error ? err.message : err);
  }

  // Granola
  try {
    const granola = getIntegration("granola");
    if (granola && granola.status === "connected") {
      const config = JSON.parse(decrypt(granola.config));
      const { startGranola } = require("./services/granola");
      startGranola(config);
      console.log("Granola reconnected");
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Granola:", err instanceof Error ? err.message : err);
  }

  // ContactOut
  try {
    const contactout = getIntegration("contactout");
    if (contactout && contactout.status === "connected") {
      const config = JSON.parse(decrypt(contactout.config));
      const { startContactOut } = require("./services/contactout");
      startContactOut(config);
      console.log("ContactOut reconnected (user key)");
    } else {
      const { autoStartContactOut } = require("./services/contactout");
      autoStartContactOut();
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect ContactOut:", err instanceof Error ? err.message : err);
  }

  // Agree.com
  try {
    const agree = getIntegration("agree");
    if (agree && agree.status === "connected") {
      const config = JSON.parse(decrypt(agree.config));
      const { startAgree } = require("./services/agree");
      startAgree(config);
      console.log("Agree.com reconnected");
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Agree.com:", err instanceof Error ? err.message : err);
  }

  // Mailchimp
  try {
    const mailchimp = getIntegration("mailchimp");
    if (mailchimp && mailchimp.status === "connected") {
      const config = JSON.parse(decrypt(mailchimp.config));
      const { startMailchimp } = require("./services/mailchimp");
      startMailchimp(config);
      console.log(`Mailchimp reconnected (${config.account_name || config.server})`);
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Mailchimp:", err instanceof Error ? err.message : err);
  }

  // Gamma
  try {
    const gamma = getIntegration("gamma");
    if (gamma && gamma.status === "connected") {
      const config = JSON.parse(decrypt(gamma.config));
      const { startGamma } = require("./services/gamma");
      startGamma(config);
      console.log("Gamma reconnected");
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect Gamma:", err instanceof Error ? err.message : err);
  }

  // WordPress
  try {
    const wordpress = getIntegration("wordpress");
    if (wordpress && wordpress.status === "connected") {
      const config = JSON.parse(decrypt(wordpress.config));
      const { startWordPress } = require("./services/wordpress");
      startWordPress(config);
      console.log(`WordPress reconnected (${config.site_name})`);
    }
  } catch (err: unknown) {
    console.error("Failed to reconnect WordPress:", err instanceof Error ? err.message : err);
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
