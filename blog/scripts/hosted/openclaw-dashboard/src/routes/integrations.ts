import { Router, Request, Response } from "express";
import { getIntegration, upsertIntegration, deleteIntegration, getAllIntegrations, getGoogleIntegrations, getSetting, setSetting } from "../services/db";
import { encrypt, decrypt } from "../services/encryption";
import { buildSlackOAuthUrl, stopSlack, isSlackRunning, getSlackOwnerUserId, setSlackOwnerUserId, isApprovalEnabled } from "../services/slack";
import { signupAndCreateInbox, createInbox, startEmail, stopEmail, isEmailRunning } from "../services/email";
import { buildOAuthUrl, stopGoogle, isGoogleRunning, startGmailPolling, stopGmailPolling } from "../services/google";
import { startSupabase, stopSupabase, testSupabaseConnection, probeSupabaseHealth } from "../services/supabase";
import { buildAirtableOAuthUrl, stopAirtable } from "../services/airtable";
import { buildNotionOAuthUrl, stopNotion, getNotionWorkspaceName } from "../services/notion";
import { startBuffer, stopBuffer, testBufferConnection, bufferListChannels, isBufferRunning } from "../services/buffer";
import { startLuma, stopLuma, testLumaConnection } from "../services/luma";
import { buildTwitterOAuthUrl, stopTwitter } from "../services/twitter";
import { startBeehiiv, stopBeehiiv, testBeehiivConnection } from "../services/beehiiv";

const router = Router();

router.get("/integrations", async (req: Request, res: Response) => {
  const integrations = getAllIntegrations();
  const integrationMap: Record<string, { status: string; error_message: string | null; config: string }> = {};
  for (const i of integrations) {
    integrationMap[i.type] = { status: i.status, error_message: i.error_message, config: i.config };
  }

  let emailAddress: string | null = null;
  let emailFilterMode = "all";
  let emailFilterDomain = "";
  let emailFilterAddresses: string[] = [];
  const emailIntegration = integrationMap["email"];
  if (emailIntegration && emailIntegration.status === "connected") {
    try {
      const config = JSON.parse(decrypt(emailIntegration.config));
      emailAddress = config.email_address || null;
      emailFilterMode = config.filter_mode || "all";
      emailFilterDomain = config.filter_domain || "";
      emailFilterAddresses = config.filter_addresses || [];
    } catch {}
  }

  // Build multi-account Google data
  const googleAccountsList: { email: string; services: string[]; typeKey: string }[] = [];
  const googleRows = getGoogleIntegrations();
  for (const row of googleRows) {
    if (row.status !== "connected") continue;
    try {
      const config = JSON.parse(decrypt(row.config));
      googleAccountsList.push({
        email: config.google_email || "Unknown",
        services: config.services || [],
        typeKey: row.type,
      });
    } catch {}
  }

  let slackTeamName: string | null = null;
  const slackIntegration = integrationMap["slack"];
  if (slackIntegration && slackIntegration.status === "connected") {
    try {
      const config = JSON.parse(decrypt(slackIntegration.config));
      slackTeamName = config.team_name || null;
    } catch {}
  }

  let notionWorkspaceName: string | null = null;
  const notionIntegration = integrationMap["notion"];
  if (notionIntegration && notionIntegration.status === "connected") {
    try {
      const config = JSON.parse(decrypt(notionIntegration.config));
      notionWorkspaceName = config.workspace_name || null;
    } catch {}
  }

  let supabaseProjectUrl: string | null = null;
  let supabasePermissions: string[] = ["read"];
  const supabaseIntegration = integrationMap["supabase"];
  if (supabaseIntegration && supabaseIntegration.status === "connected") {
    try {
      const config = JSON.parse(decrypt(supabaseIntegration.config));
      supabaseProjectUrl = config.project_url || null;
      supabasePermissions = config.permissions || ["read"];
    } catch {}
  }

  // Gmail email rules + polling settings
  let gmailFilter: Record<string, any> = { mode: "all", domains: [], addresses: [], poll_interval: "0", reply_mode: "draft" };
  try {
    const raw = getSetting("gmail_email_rules");
    if (raw) gmailFilter = { ...gmailFilter, ...JSON.parse(raw) };
  } catch {}
  gmailFilter.poll_interval = getSetting("gmail_poll_interval") || "0";
  gmailFilter.reply_mode = getSetting("gmail_reply_mode") || "draft";

  res.render("integrations", {
    slack: {
      ...(integrationMap["slack"] || { status: "disconnected", error_message: null }),
      team_name: slackTeamName,
      owner_user_id: getSlackOwnerUserId() || "",
      approval_enabled: isApprovalEnabled(),
    },
    email: {
      ...(integrationMap["email"] || { status: "disconnected", error_message: null }),
      email_address: emailAddress,
      filter_mode: emailFilterMode,
      filter_domain: emailFilterDomain,
      filter_addresses: emailFilterAddresses,
    },
    googleAccounts: googleAccountsList,
    gmailFilter,
    supabase: {
      ...(integrationMap["supabase"] || { status: "disconnected", error_message: null }),
      project_url: supabaseProjectUrl,
      permissions: supabasePermissions,
    },
    airtable: integrationMap["airtable"] || { status: "disconnected", error_message: null },
    notion: {
      ...(integrationMap["notion"] || { status: "disconnected", error_message: null }),
      workspace_name: notionWorkspaceName,
    },
    buffer: await (async () => {
      const bi = integrationMap["buffer"];
      const base = { ...(bi || { status: "disconnected", error_message: null }), organization_name: null as string | null, channels: [] as any[], selected_channels: [] as string[], channels_error: false, pending_orgs: [] as { id: string; name: string }[] };
      if (bi && bi.status === "pending") {
        try {
          const pending = JSON.parse(decrypt(bi.config));
          base.pending_orgs = pending.organizations || [];
        } catch {}
      } else if (bi && bi.status === "connected") {
        try {
          const config = JSON.parse(decrypt(bi.config));
          base.organization_name = config.organization_name || null;
          base.selected_channels = config.selected_channels || [];
        } catch {}
        try {
          const raw = await bufferListChannels();
          const parsed = JSON.parse(raw);
          if (parsed.channels) base.channels = parsed.channels;
          else base.channels_error = true;
        } catch { base.channels_error = true; }
      }
      return base;
    })(),
    luma: {
      ...(integrationMap["luma"] || { status: "disconnected", error_message: null }),
      ...(() => {
        const li = integrationMap["luma"];
        if (li && li.status === "connected") {
          try {
            const cfg = JSON.parse(decrypt(li.config));
            return { user_name: cfg.user_name || null, calendar_name: cfg.calendar_name || null };
          } catch { return { user_name: null, calendar_name: null }; }
        }
        return { user_name: null, calendar_name: null };
      })(),
    },
    twitter: {
      ...(integrationMap["twitter"] || { status: "disconnected", error_message: null }),
      username: (() => {
        const ti = integrationMap["twitter"];
        if (ti && ti.status === "connected") {
          try { return JSON.parse(decrypt(ti.config)).username || null; } catch { return null; }
        }
        return null;
      })(),
    },
    beehiiv: (() => {
      const bi = integrationMap["beehiiv"];
      const base = { ...(bi || { status: "disconnected", error_message: null }), publication_name: null as string | null, templates: [] as { name: string; id: string }[], pending_pubs: [] as { id: string; name: string }[] };
      if (bi && bi.status === "pending") {
        try {
          const pending = JSON.parse(decrypt(bi.config));
          base.pending_pubs = pending.publications || [];
        } catch {}
      } else if (bi && bi.status === "connected") {
        try {
          const config = JSON.parse(decrypt(bi.config));
          base.publication_name = config.publication_name || null;
          base.templates = config.templates || [];
        } catch {}
      }
      return base;
    })(),
    flash: req.query.flash || null,
  });
});

router.post("/integrations/slack/connect", (req: Request, res: Response) => {
  try {
    const url = buildSlackOAuthUrl();
    res.redirect(url);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Slack+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/slack/disconnect", async (req: Request, res: Response) => {
  // Revoke token at Slack (fire-and-forget)
  try {
    const integration = getIntegration("slack");
    if (integration && integration.status === "connected") {
      const config = JSON.parse(decrypt(integration.config));
      if (config.bot_token) {
        fetch("https://slack.com/api/auth.revoke", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Bearer ${config.bot_token}`,
          },
        }).catch(() => {});
      }
    }
  } catch {}

  stopSlack();
  upsertIntegration("slack", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Slack+disconnected");
});

router.post("/integrations/slack/approval", (req: Request, res: Response) => {
  try {
    const enabled = req.body.approval_enabled === "on";
    setSetting("slack_approval_enabled", enabled ? "true" : "false");

    const ownerUserId = (req.body.owner_user_id || "").trim();
    if (ownerUserId) {
      setSlackOwnerUserId(ownerUserId);
    }

    res.redirect(303, "/integrations?flash=Slack+access+control+saved");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Slack+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/email/connect", async (req: Request, res: Response) => {
  try {
    const userApiKey = req.body.api_key?.trim() || "";
    let result: { apiToken: string; inboxId: string; emailAddress: string };

    if (userApiKey) {
      result = await createInbox(userApiKey);
    } else {
      result = await signupAndCreateInbox();
    }

    const config = encrypt(
      JSON.stringify({
        api_token: result.apiToken,
        inbox_id: result.inboxId,
        email_address: result.emailAddress,
        user_provided_key: !!userApiKey,
      })
    );
    startEmail(result);
    upsertIntegration("email", config, "connected");
    res.redirect(303, "/integrations?flash=Email+connected:+" + encodeURIComponent(result.emailAddress));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    upsertIntegration("email", "{}", "error", message);
    res.redirect(303, "/integrations?flash=Email+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/email/filter", (req: Request, res: Response) => {
  try {
    const integration = getIntegration("email");
    if (!integration || integration.status !== "connected") {
      res.redirect(303, "/integrations?flash=Email+not+connected");
      return;
    }

    const config = JSON.parse(decrypt(integration.config));
    const { filter_mode, filter_domain, filter_addresses } = req.body;

    const validModes = ["all", "domain", "addresses"];
    config.filter_mode = validModes.includes(filter_mode) ? filter_mode : "all";
    config.filter_domain = (filter_domain || "").trim().toLowerCase().replace(/^@/, "");

    // Parse addresses: could be a comma-separated string or an array from hidden inputs
    let addresses: string[] = [];
    if (typeof filter_addresses === "string") {
      addresses = filter_addresses.split(",").map((a: string) => a.trim().toLowerCase()).filter(Boolean);
    } else if (Array.isArray(filter_addresses)) {
      addresses = filter_addresses.map((a: string) => a.trim().toLowerCase()).filter(Boolean);
    }
    config.filter_addresses = addresses;

    const encrypted = encrypt(JSON.stringify(config));
    upsertIntegration("email", encrypted, "connected");
    res.redirect(303, "/integrations?flash=Email+filter+saved");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Filter+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/email/disconnect", (req: Request, res: Response) => {
  stopEmail();
  upsertIntegration("email", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Email+disconnected");
});

router.post("/integrations/google/connect", (req: Request, res: Response) => {
  try {
    const services = req.body.services;
    const serviceList = Array.isArray(services) ? services : services ? [services] : [];
    if (serviceList.length === 0) {
      res.redirect(303, "/integrations?flash=Select+at+least+one+Google+service");
      return;
    }
    const url = buildOAuthUrl(serviceList);
    res.redirect(url);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Google+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/google/disconnect", async (req: Request, res: Response) => {
  const account = req.body.account as string | undefined;
  if (!account) {
    res.redirect(303, "/integrations?flash=Missing+account");
    return;
  }

  const typeKey = `google:${account}`;

  // Revoke token at Google (fire-and-forget)
  try {
    const integration = getIntegration(typeKey);
    if (integration && integration.status === "connected") {
      const config = JSON.parse(decrypt(integration.config));
      if (config.refresh_token) {
        fetch(`https://oauth2.googleapis.com/revoke?token=${config.refresh_token}`, {
          method: "POST",
        }).catch(() => {});
      }
    }
  } catch {}

  stopGoogle(account);
  deleteIntegration(typeKey);
  res.redirect(303, "/integrations?flash=Google+disconnected");
});

router.post("/integrations/supabase/connect", async (req: Request, res: Response) => {
  try {
    const rawUrl = (req.body.project_url || "").trim();
    const apiKey = (req.body.api_key || "").trim();

    if (!rawUrl) {
      res.redirect(303, "/integrations?flash=Project+URL+is+required");
      return;
    }

    // Normalize to origin only (strips paths, credentials, trailing slashes)
    let projectUrl: string;
    try {
      const urlWithScheme = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
      projectUrl = new URL(urlWithScheme).origin;
    } catch {
      res.redirect(303, "/integrations?flash=Invalid+Project+URL");
      return;
    }
    if (!apiKey) {
      res.redirect(303, "/integrations?flash=API+key+is+required");
      return;
    }

    // Parse permissions checkboxes (read is always included)
    const rawPerms = req.body.permissions;
    const permsList = Array.isArray(rawPerms) ? rawPerms : rawPerms ? [rawPerms] : [];
    const permissions = ["read", ...permsList.filter((p: string) => ["insert", "update"].includes(p))];

    // Test connection
    console.log(`Supabase connect: testing ${projectUrl}`);
    await testSupabaseConnection(projectUrl, apiKey);
    console.log("Supabase connect: test passed");

    const config = encrypt(JSON.stringify({ project_url: projectUrl, api_key: apiKey, permissions }));
    startSupabase({ projectUrl, apiKey, permissions });
    upsertIntegration("supabase", config, "connected");

    // Probe tables in the background to detect slow/unindexed ones
    const probe = await probeSupabaseHealth();
    console.log(`Supabase probe: ${probe.totalTables} tables, ${probe.slowTables.length} slow, ${probe.fastTables.length} fast`);

    if (probe.schemaTimeout) {
      res.redirect(303, "/integrations?flash=" + encodeURIComponent(
        "Supabase connected — Warning: your database schema took too long to load. Queries may be very slow. Consider adding indexes to your tables."
      ));
    } else if (probe.slowTables.length > 0) {
      const warning = probe.slowTables.length === probe.totalTables
        ? `Supabase connected — Warning: all ${probe.totalTables} tables appear to be slow (possibly missing indexes). Queries will likely time out. Consider adding indexes or using smaller tables.`
        : `Supabase connected — Warning: ${probe.slowTables.length} of ${Math.min(probe.totalTables, 10)} tables tested are slow to query (${probe.slowTables.slice(0, 5).join(", ")}${probe.slowTables.length > 5 ? "..." : ""}). These may be missing database indexes.`;
      res.redirect(303, "/integrations?flash=" + encodeURIComponent(warning));
    } else {
      res.redirect(303, "/integrations?flash=Supabase+connected");
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Supabase connect error:", message, err instanceof Error ? err.cause : "");
    upsertIntegration("supabase", "{}", "error", message);
    res.redirect(303, "/integrations?flash=Supabase+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/supabase/disconnect", (req: Request, res: Response) => {
  stopSupabase();
  upsertIntegration("supabase", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Supabase+disconnected");
});

router.post("/integrations/supabase/permissions", (req: Request, res: Response) => {
  try {
    const integration = getIntegration("supabase");
    if (!integration || integration.status !== "connected") {
      res.redirect(303, "/integrations?flash=Supabase+not+connected");
      return;
    }

    const config = JSON.parse(decrypt(integration.config));
    const rawPerms = req.body.permissions;
    const permsList = Array.isArray(rawPerms) ? rawPerms : rawPerms ? [rawPerms] : [];
    config.permissions = ["read", ...permsList.filter((p: string) => ["insert", "update"].includes(p))];

    const encrypted = encrypt(JSON.stringify(config));
    upsertIntegration("supabase", encrypted, "connected");

    // Restart with updated permissions
    startSupabase({ projectUrl: config.project_url, apiKey: config.api_key, permissions: config.permissions });

    res.redirect(303, "/integrations?flash=Supabase+permissions+saved");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Permission+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/google/email-rules", (req: Request, res: Response) => {
  try {
    const { filter_mode, filter_domains, filter_addresses } = req.body;
    const validModes = ["all", "domains", "addresses"];
    const mode = validModes.includes(filter_mode) ? filter_mode : "all";

    let domains: string[] = [];
    if (typeof filter_domains === "string") {
      domains = filter_domains.split(",").map((d: string) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
    }

    let addresses: string[] = [];
    if (typeof filter_addresses === "string") {
      addresses = filter_addresses.split(",").map((a: string) => a.trim().toLowerCase()).filter(Boolean);
    } else if (Array.isArray(filter_addresses)) {
      addresses = filter_addresses.map((a: string) => a.trim().toLowerCase()).filter(Boolean);
    }

    setSetting("gmail_email_rules", JSON.stringify({ mode, domains, addresses }));

    // Save polling settings
    const { poll_interval, reply_mode } = req.body;
    const validIntervals = ["0", "300000", "900000", "1800000", "3600000"];
    setSetting("gmail_poll_interval", validIntervals.includes(poll_interval) ? poll_interval : "0");
    setSetting("gmail_reply_mode", reply_mode === "send" ? "send" : "draft");

    // Restart polling with new settings
    stopGmailPolling();
    if (poll_interval && poll_interval !== "0") {
      startGmailPolling();
    }

    res.redirect(303, "/integrations?flash=Gmail+settings+saved");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Gmail+rules+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/airtable/connect", (req: Request, res: Response) => {
  try {
    const url = buildAirtableOAuthUrl();
    res.redirect(url);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Airtable+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/airtable/disconnect", async (req: Request, res: Response) => {
  stopAirtable();
  upsertIntegration("airtable", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Airtable+disconnected");
});

router.post("/integrations/notion/connect", (req: Request, res: Response) => {
  try {
    const url = buildNotionOAuthUrl();
    res.redirect(url);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Notion+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/notion/disconnect", async (req: Request, res: Response) => {
  stopNotion();
  upsertIntegration("notion", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Notion+disconnected");
});

router.post("/integrations/buffer/connect", async (req: Request, res: Response) => {
  try {
    const apiKey = (req.body.api_key || "").trim();
    if (!apiKey) {
      res.redirect(303, "/integrations?flash=API+key+is+required");
      return;
    }

    const { organizations } = await testBufferConnection(apiKey);

    if (organizations.length === 1) {
      // Single org — connect directly
      const configData = { api_key: apiKey, organization_id: organizations[0].id, organization_name: organizations[0].name };
      const config = encrypt(JSON.stringify(configData));
      upsertIntegration("buffer", config, "connected");
      startBuffer(configData);
      res.redirect(303, "/integrations?flash=Buffer+connected+successfully");
    } else {
      // Multiple orgs — store key temporarily and show org picker
      const pending = encrypt(JSON.stringify({ api_key: apiKey, organizations }));
      upsertIntegration("buffer", pending, "pending");
      res.redirect(303, "/integrations?flash=Choose+an+organization");
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Connection failed";
    upsertIntegration("buffer", "{}", "disconnected", message);
    res.redirect(303, "/integrations?flash=" + encodeURIComponent(message));
  }
});

router.post("/integrations/buffer/select-org", (req: Request, res: Response) => {
  try {
    const integration = getIntegration("buffer");
    if (!integration || integration.status !== "pending") {
      res.redirect(303, "/integrations?flash=No+pending+Buffer+connection");
      return;
    }

    const pending = JSON.parse(decrypt(integration.config));
    const selectedOrgId = req.body.organization_id;
    const org = pending.organizations.find((o: any) => o.id === selectedOrgId);
    if (!org) {
      res.redirect(303, "/integrations?flash=Invalid+organization");
      return;
    }

    const configData = { api_key: pending.api_key, organization_id: org.id, organization_name: org.name };
    const config = encrypt(JSON.stringify(configData));
    upsertIntegration("buffer", config, "connected");
    startBuffer(configData);
    res.redirect(303, "/integrations?flash=Buffer+connected+to+" + encodeURIComponent(org.name));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Buffer+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/buffer/disconnect", async (req: Request, res: Response) => {
  stopBuffer();
  upsertIntegration("buffer", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Buffer+disconnected");
});

router.post("/integrations/buffer/channels", (req: Request, res: Response) => {
  try {
    const integration = getIntegration("buffer");
    if (!integration || integration.status !== "connected") {
      res.redirect(303, "/integrations?flash=Buffer+not+connected");
      return;
    }

    const config = JSON.parse(decrypt(integration.config));
    const rawChannels = req.body.channels;
    config.selected_channels = Array.isArray(rawChannels) ? rawChannels : rawChannels ? [rawChannels] : [];

    const encrypted = encrypt(JSON.stringify(config));
    upsertIntegration("buffer", encrypted, "connected");
    startBuffer(config);

    res.redirect(303, "/integrations?flash=Buffer+channels+saved");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Channel+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/luma/connect", async (req: Request, res: Response) => {
  try {
    const apiKey = (req.body.api_key || "").trim();
    if (!apiKey) {
      res.redirect(303, "/integrations?flash=API+key+is+required");
      return;
    }

    console.log("Luma connect: testing API key");
    const { user_name, calendar_name } = await testLumaConnection(apiKey);
    console.log(`Luma connect: test passed (${user_name}${calendar_name ? `, calendar: ${calendar_name}` : ""})`);

    const config = encrypt(JSON.stringify({ api_key: apiKey, user_name, calendar_name }));
    startLuma({ api_key: apiKey, user_name, calendar_name });
    upsertIntegration("luma", config, "connected");
    res.redirect(303, "/integrations?flash=Luma+connected");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Luma connect error:", message);
    upsertIntegration("luma", "{}", "error", message);
    res.redirect(303, "/integrations?flash=Luma+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/luma/disconnect", (req: Request, res: Response) => {
  stopLuma();
  upsertIntegration("luma", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Luma+disconnected");
});

router.post("/integrations/twitter/connect", (req: Request, res: Response) => {
  try {
    const url = buildTwitterOAuthUrl();
    res.redirect(url);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Twitter+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/twitter/disconnect", async (req: Request, res: Response) => {
  // Revoke token at X (fire-and-forget)
  try {
    const integration = getIntegration("twitter");
    if (integration && integration.status === "connected") {
      const config = JSON.parse(decrypt(integration.config));
      if (config.access_token) {
        fetch("https://api.x.com/2/oauth2/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: config.access_token,
            client_id: process.env.TWITTER_CLIENT_ID || "",
            token_type_hint: "access_token",
          }),
        }).catch(() => {});
      }
    }
  } catch {}

  stopTwitter();
  upsertIntegration("twitter", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Twitter+disconnected");
});

// --- Beehiiv ---

router.post("/integrations/beehiiv/connect", async (req: Request, res: Response) => {
  try {
    const apiKey = (req.body.api_key || "").trim();
    if (!apiKey) {
      res.redirect(303, "/integrations?flash=API+key+is+required");
      return;
    }

    const { publications } = await testBeehiivConnection(apiKey);

    if (publications.length === 1) {
      // Parse templates from form
      const templates = parseTemplateRows(req.body);
      const configData = { api_key: apiKey, publication_id: publications[0].id, publication_name: publications[0].name, templates };
      const config = encrypt(JSON.stringify(configData));
      upsertIntegration("beehiiv", config, "connected");
      startBeehiiv(configData);
      res.redirect(303, "/integrations?flash=Beehiiv+connected+successfully");
    } else {
      // Multiple publications — store key temporarily and show picker
      const templates = parseTemplateRows(req.body);
      const pending = encrypt(JSON.stringify({ api_key: apiKey, publications, templates }));
      upsertIntegration("beehiiv", pending, "pending");
      res.redirect(303, "/integrations?flash=Choose+a+publication");
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Connection failed";
    upsertIntegration("beehiiv", "{}", "disconnected", message);
    res.redirect(303, "/integrations?flash=" + encodeURIComponent(message));
  }
});

router.post("/integrations/beehiiv/select-pub", (req: Request, res: Response) => {
  try {
    const integration = getIntegration("beehiiv");
    if (!integration || integration.status !== "pending") {
      res.redirect(303, "/integrations?flash=No+pending+Beehiiv+connection");
      return;
    }

    const pending = JSON.parse(decrypt(integration.config));
    const selectedPubId = req.body.publication_id;
    const pub = pending.publications.find((p: any) => p.id === selectedPubId);
    if (!pub) {
      res.redirect(303, "/integrations?flash=Invalid+publication");
      return;
    }

    const configData = { api_key: pending.api_key, publication_id: pub.id, publication_name: pub.name, templates: pending.templates || [] };
    const config = encrypt(JSON.stringify(configData));
    upsertIntegration("beehiiv", config, "connected");
    startBeehiiv(configData);
    res.redirect(303, "/integrations?flash=Beehiiv+connected+to+" + encodeURIComponent(pub.name));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Beehiiv+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/beehiiv/templates", (req: Request, res: Response) => {
  try {
    const integration = getIntegration("beehiiv");
    if (!integration || integration.status !== "connected") {
      res.redirect(303, "/integrations?flash=Beehiiv+not+connected");
      return;
    }

    const config = JSON.parse(decrypt(integration.config));
    config.templates = parseTemplateRows(req.body);

    const encrypted = encrypt(JSON.stringify(config));
    upsertIntegration("beehiiv", encrypted, "connected");
    startBeehiiv(config);

    res.redirect(303, "/integrations?flash=Beehiiv+templates+saved");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Template+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/beehiiv/disconnect", (req: Request, res: Response) => {
  stopBeehiiv();
  upsertIntegration("beehiiv", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Beehiiv+disconnected");
});

function parseTemplateRows(body: any): { name: string; id: string }[] {
  const names = Array.isArray(body.template_name) ? body.template_name : body.template_name ? [body.template_name] : [];
  const ids = Array.isArray(body.template_id) ? body.template_id : body.template_id ? [body.template_id] : [];
  const templates: { name: string; id: string }[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = (names[i] || "").trim();
    const id = (ids[i] || "").trim();
    if (name && id) templates.push({ name, id });
  }
  return templates;
}

export default router;
