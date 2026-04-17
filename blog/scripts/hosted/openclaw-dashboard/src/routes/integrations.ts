import { Router, Request, Response } from "express";
import { getIntegration, upsertIntegration, deleteIntegration, getAllIntegrations, getGoogleIntegrations, getSetting, setSetting, getAllMemories } from "../services/db";
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
import { startBeehiiv, stopBeehiiv, testBeehiivConnection, fetchTemplates } from "../services/beehiiv";
import { buildGranolaOAuthUrl, stopGranola, isGranolaRunning } from "../services/granola";
import { startContactOut, stopContactOut, isContactOutRunning, testContactOutConnection } from "../services/contactout";
import { startAgree, stopAgree, testAgreeConnection } from "../services/agree";
import { startGamma, stopGamma, testGammaConnection } from "../services/gamma";

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

  // Gmail email policy — simplified single-policy format
  interface GmailEmailPolicy { policy: string; reply_mode: string; domains: string[]; addresses: string[] }
  let gmailEmailPolicy: GmailEmailPolicy = { policy: "known", reply_mode: "draft", domains: [], addresses: [] };
  try {
    const raw = JSON.parse(getSetting("gmail_email_policy") || "{}");
    if (raw.policy) {
      gmailEmailPolicy = raw;
    } else {
      // Migrate from old tiered format
      const oldRules = JSON.parse(getSetting("gmail_email_rules") || "{}");
      const oldPolicy = getSetting("gmail_sender_policy") || "known";
      if (oldRules.tiers) {
        const everyone = oldRules.tiers.find((t: any) => t.type === "everyone");
        const domains = oldRules.tiers.find((t: any) => t.type === "domains");
        const addresses = oldRules.tiers.find((t: any) => t.type === "addresses");
        if (addresses?.enabled && addresses.addresses?.length) {
          gmailEmailPolicy = { policy: "addresses", reply_mode: addresses.reply_mode || "draft", domains: domains?.domains || [], addresses: addresses.addresses };
        } else if (domains?.enabled && domains.domains?.length) {
          gmailEmailPolicy = { policy: "domains", reply_mode: domains.reply_mode || "draft", domains: domains.domains, addresses: [] };
        } else if (everyone?.enabled) {
          gmailEmailPolicy = { policy: oldPolicy === "everyone" ? "everyone" : "known", reply_mode: everyone.reply_mode || "draft", domains: [], addresses: [] };
        } else {
          gmailEmailPolicy = { policy: "disabled", reply_mode: "draft", domains: [], addresses: [] };
        }
      }
    }
  } catch {}
  const gmailPollInterval = getSetting("gmail_poll_interval") || "0";

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
    gmailEmailPolicy,
    gmailPollInterval,
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
    granola: integrationMap["granola"] || { status: "disconnected", error_message: null },
    contactout: integrationMap["contactout"] || { status: "disconnected", error_message: null },
    agree: integrationMap["agree"] || { status: "disconnected", error_message: null },
    gamma: integrationMap["gamma"] || { status: "disconnected", error_message: null },
    memories: getAllMemories(),
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
    const validPolicies = ["everyone", "known", "domains", "addresses", "disabled"];
    const policy = validPolicies.includes(req.body.policy) ? req.body.policy : "known";
    const reply_mode = req.body.reply_mode === "send" ? "send" : "draft";

    let domains: string[] = [];
    if (typeof req.body.filter_domains === "string") {
      domains = req.body.filter_domains.split(",").map((d: string) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
    }

    let addresses: string[] = [];
    if (typeof req.body.filter_addresses === "string") {
      addresses = req.body.filter_addresses.split(",").map((a: string) => a.trim().toLowerCase()).filter(Boolean);
    } else if (Array.isArray(req.body.filter_addresses)) {
      addresses = req.body.filter_addresses.map((a: string) => a.trim().toLowerCase()).filter(Boolean);
    }

    setSetting("gmail_email_policy", JSON.stringify({ policy, reply_mode, domains, addresses }));

    // Save polling settings
    const { poll_interval } = req.body;
    const validIntervals = ["0", "300000", "900000", "1800000", "3600000"];
    setSetting("gmail_poll_interval", validIntervals.includes(poll_interval) ? poll_interval : "0");

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

// Diagnostic: test Luma location update
router.get("/integrations/luma/test-location", async (req: Request, res: Response) => {
  const eventId = req.query.event_id as string;
  const location = (req.query.location as string) || "123 Main St, San Francisco, CA";
  if (!eventId) {
    res.json({ error: "event_id query param required" });
    return;
  }
  try {
    const { lumaTestLocationUpdate } = require("../services/luma");
    const result = await lumaTestLocationUpdate(eventId, location);
    res.json(result);
  } catch (err: unknown) {
    res.json({ error: err instanceof Error ? err.message : "Test failed" });
  }
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
      const templates = await fetchTemplates(apiKey, publications[0].id);
      const configData = { api_key: apiKey, publication_id: publications[0].id, publication_name: publications[0].name, templates };
      const config = encrypt(JSON.stringify(configData));
      upsertIntegration("beehiiv", config, "connected");
      startBeehiiv(configData);
      res.redirect(303, "/integrations?flash=Beehiiv+connected+successfully");
    } else {
      // Multiple publications — store key temporarily and show picker
      const pending = encrypt(JSON.stringify({ api_key: apiKey, publications }));
      upsertIntegration("beehiiv", pending, "pending");
      res.redirect(303, "/integrations?flash=Choose+a+publication");
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Connection failed";
    upsertIntegration("beehiiv", "{}", "disconnected", message);
    res.redirect(303, "/integrations?flash=" + encodeURIComponent(message));
  }
});

router.post("/integrations/beehiiv/select-pub", async (req: Request, res: Response) => {
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

    const templates = await fetchTemplates(pending.api_key, pub.id);
    const configData = { api_key: pending.api_key, publication_id: pub.id, publication_name: pub.name, templates };
    const config = encrypt(JSON.stringify(configData));
    upsertIntegration("beehiiv", config, "connected");
    startBeehiiv(configData);
    res.redirect(303, "/integrations?flash=Beehiiv+connected+to+" + encodeURIComponent(pub.name));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Beehiiv+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/beehiiv/refresh-templates", async (req: Request, res: Response) => {
  try {
    const integration = getIntegration("beehiiv");
    if (!integration || integration.status !== "connected") {
      res.redirect(303, "/integrations?flash=Beehiiv+not+connected");
      return;
    }

    const config = JSON.parse(decrypt(integration.config));
    config.templates = await fetchTemplates(config.api_key, config.publication_id);

    const encrypted = encrypt(JSON.stringify(config));
    upsertIntegration("beehiiv", encrypted, "connected");
    startBeehiiv(config);

    res.redirect(303, "/integrations?flash=Templates+refreshed+(" + config.templates.length + "+found)");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Refresh+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/beehiiv/disconnect", (req: Request, res: Response) => {
  stopBeehiiv();
  upsertIntegration("beehiiv", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Beehiiv+disconnected");
});

// --- Granola ---

router.post("/integrations/granola/connect", async (req: Request, res: Response) => {
  try {
    const url = await buildGranolaOAuthUrl();
    res.redirect(url);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/integrations?flash=Granola+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/granola/disconnect", (req: Request, res: Response) => {
  stopGranola();
  upsertIntegration("granola", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Granola+disconnected");
});

// --- ContactOut ---

router.post("/integrations/contactout/connect", async (req: Request, res: Response) => {
  const { api_token } = req.body;
  if (!api_token?.trim()) {
    res.redirect(303, "/integrations?flash=ContactOut+API+token+is+required");
    return;
  }

  try {
    await testContactOutConnection(api_token.trim());
    const config = encrypt(JSON.stringify({ api_token: api_token.trim() }));
    upsertIntegration("contactout", config, "connected");
    startContactOut({ api_token: api_token.trim() });
    res.redirect(303, "/integrations?flash=ContactOut+connected+successfully");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Connection failed";
    upsertIntegration("contactout", "{}", "error", message);
    res.redirect(303, "/integrations?flash=ContactOut+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/contactout/disconnect", (req: Request, res: Response) => {
  stopContactOut();
  upsertIntegration("contactout", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=ContactOut+disconnected");
});

// --- Agree.com ---

router.post("/integrations/agree/connect", async (req: Request, res: Response) => {
  const { api_key } = req.body;
  if (!api_key?.trim()) {
    res.redirect(303, "/integrations?flash=Agree.com+API+key+is+required");
    return;
  }

  try {
    await testAgreeConnection(api_key.trim());
    const config = encrypt(JSON.stringify({ api_key: api_key.trim() }));
    upsertIntegration("agree", config, "connected");
    startAgree({ api_key: api_key.trim() });
    res.redirect(303, "/integrations?flash=Agree.com+connected+successfully");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Connection failed";
    upsertIntegration("agree", "{}", "error", message);
    res.redirect(303, "/integrations?flash=Agree+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/agree/disconnect", (req: Request, res: Response) => {
  stopAgree();
  upsertIntegration("agree", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Agree.com+disconnected");
});

// --- Gamma ---

router.post("/integrations/gamma/connect", async (req: Request, res: Response) => {
  const { api_key } = req.body;
  if (!api_key?.trim()) {
    res.redirect(303, "/integrations?flash=Gamma+API+key+is+required");
    return;
  }

  try {
    await testGammaConnection(api_key.trim());
    const config = encrypt(JSON.stringify({ api_key: api_key.trim() }));
    upsertIntegration("gamma", config, "connected");
    startGamma({ api_key: api_key.trim() });
    res.redirect(303, "/integrations?flash=Gamma+connected+successfully");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Connection failed";
    upsertIntegration("gamma", "{}", "error", message);
    res.redirect(303, "/integrations?flash=Gamma+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/gamma/disconnect", (req: Request, res: Response) => {
  stopGamma();
  upsertIntegration("gamma", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Gamma+disconnected");
});

// --- Health Checks ---

router.post("/integrations/:type/health-check", async (req: Request, res: Response) => {
  const type = req.params.type;
  const start = Date.now();

  try {
    let result: { success: boolean; detail?: string; error?: string };

    if (type === "slack") {
      const integration = getIntegration("slack");
      if (!integration || integration.status !== "connected") throw new Error("Not connected");
      const config = JSON.parse(decrypt(integration.config));
      const resp = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${config.bot_token}` },
      });
      const data: any = await resp.json();
      result = data.ok ? { success: true, detail: `Team: ${data.team}` } : { success: false, error: data.error };

    } else if (type.startsWith("google:") || type === "google") {
      // Find the Google integration
      const googleIntegrations = getGoogleIntegrations();
      const integration = type === "google" ? googleIntegrations[0] : googleIntegrations.find(g => g.type === type);
      if (!integration || integration.status !== "connected") throw new Error("Not connected");
      const config = JSON.parse(decrypt(integration.config));
      // Test with a simple Gmail profile call
      const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${config.access_token}` },
      });
      if (resp.ok) {
        const data: any = await resp.json();
        result = { success: true, detail: `Email: ${data.emailAddress}` };
      } else {
        result = { success: false, error: `Gmail API returned ${resp.status}` };
      }

    } else if (type === "supabase") {
      const probeResult = await (await import("../services/supabase")).probeSupabaseHealth();
      result = probeResult;

    } else if (type === "buffer") {
      const integration = getIntegration("buffer");
      if (!integration || integration.status !== "connected") throw new Error("Not connected");
      const config = JSON.parse(decrypt(integration.config));
      const resp = await fetch("https://api.bufferapp.com/v1/profiles.json?access_token=" + config.access_token);
      result = resp.ok ? { success: true, detail: "Buffer API accessible" } : { success: false, error: `Buffer API returned ${resp.status}` };

    } else if (type === "luma") {
      const integration = getIntegration("luma");
      if (!integration || integration.status !== "connected") throw new Error("Not connected");
      const config = JSON.parse(decrypt(integration.config));
      const resp = await fetch("https://api.lu.ma/public/v1/event/list?limit=1", {
        headers: { "x-luma-api-key": config.api_key },
      });
      result = resp.ok ? { success: true, detail: "Luma API accessible" } : { success: false, error: `Luma API returned ${resp.status}` };

    } else if (type === "notion") {
      const integration = getIntegration("notion");
      if (!integration || integration.status !== "connected") throw new Error("Not connected");
      const config = JSON.parse(decrypt(integration.config));
      const resp = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.access_token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "", page_size: 1 }),
      });
      result = resp.ok ? { success: true, detail: "Notion API accessible" } : { success: false, error: `Notion API returned ${resp.status}` };

    } else if (type === "airtable") {
      const integration = getIntegration("airtable");
      if (!integration || integration.status !== "connected") throw new Error("Not connected");
      const config = JSON.parse(decrypt(integration.config));
      const resp = await fetch("https://api.airtable.com/v0/meta/bases", {
        headers: { Authorization: `Bearer ${config.access_token}` },
      });
      result = resp.ok ? { success: true, detail: "Airtable API accessible" } : { success: false, error: `Airtable API returned ${resp.status}` };

    } else if (type === "twitter") {
      const integration = getIntegration("twitter");
      if (!integration || integration.status !== "connected") throw new Error("Not connected");
      const config = JSON.parse(decrypt(integration.config));
      const resp = await fetch("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${config.access_token}` },
      });
      result = resp.ok ? { success: true, detail: "Twitter API accessible" } : { success: false, error: `Twitter API returned ${resp.status}` };

    } else if (type === "contactout") {
      const integration = getIntegration("contactout");
      if (!integration || integration.status !== "connected") throw new Error("Not connected");
      const config = JSON.parse(decrypt(integration.config));
      const resp = await fetch("https://api.contactout.com/v2/search/people?page_size=1", {
        headers: { Authorization: `Bearer ${config.api_token}`, "Content-Type": "application/json" },
      });
      result = resp.ok ? { success: true, detail: "ContactOut API accessible" } : { success: false, error: `ContactOut API returned ${resp.status}` };

    } else {
      result = { success: false, error: `Health check not implemented for ${type}` };
    }

    const responseMs = Date.now() - start;
    const healthResult = JSON.stringify({ ...result, response_ms: responseMs });

    // Update integration with health check result
    const { logActivity } = require("../services/db");
    logActivity({
      type: "integration",
      level: result.success ? "info" : "error",
      source: type,
      summary: result.success ? `Health check passed (${responseMs}ms)` : `Health check failed: ${result.error}`,
    });

    // Store last health check result
    try {
      getIntegration(type); // ensure it exists
      const db = require("../services/db").getDb();
      db.prepare("UPDATE integrations SET last_health_check = datetime('now'), last_health_result = ? WHERE type = ?")
        .run(healthResult, type);
    } catch {}

    res.json({ ...result, response_ms: responseMs });
  } catch (err: any) {
    const responseMs = Date.now() - start;
    res.json({ success: false, error: err.message || "Health check failed", response_ms: responseMs });
  }
});

export default router;
