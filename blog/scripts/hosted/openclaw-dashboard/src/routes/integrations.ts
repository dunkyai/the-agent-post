import { Router, Request, Response } from "express";
import { getIntegration, upsertIntegration, deleteIntegration, getAllIntegrations, getGoogleIntegrations } from "../services/db";
import { encrypt, decrypt } from "../services/encryption";
import { startTelegram, stopTelegram, isTelegramRunning } from "../services/telegram";
import { buildSlackOAuthUrl, stopSlack, isSlackRunning } from "../services/slack";
import { signupAndCreateInbox, createInbox, startEmail, stopEmail, isEmailRunning } from "../services/email";
import { buildOAuthUrl, stopGoogle, isGoogleRunning } from "../services/google";

const router = Router();

router.get("/integrations", (req: Request, res: Response) => {
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

  res.render("integrations", {
    telegram: integrationMap["telegram"] || { status: "disconnected", error_message: null },
    slack: {
      ...(integrationMap["slack"] || { status: "disconnected", error_message: null }),
      team_name: slackTeamName,
    },
    email: {
      ...(integrationMap["email"] || { status: "disconnected", error_message: null }),
      email_address: emailAddress,
      filter_mode: emailFilterMode,
      filter_domain: emailFilterDomain,
      filter_addresses: emailFilterAddresses,
    },
    googleAccounts: googleAccountsList,
    flash: req.query.flash || null,
  });
});

router.post("/integrations/telegram/connect", async (req: Request, res: Response) => {
  try {
    const { bot_token } = req.body;
    if (!bot_token || !bot_token.trim()) {
      res.redirect(303, "/integrations?flash=Bot+token+is+required");
      return;
    }

    const config = encrypt(JSON.stringify({ bot_token: bot_token.trim() }));
    startTelegram(bot_token.trim());
    upsertIntegration("telegram", config, "connected");
    res.redirect(303, "/integrations?flash=Telegram+connected");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    upsertIntegration("telegram", "{}", "error", message);
    res.redirect(303, "/integrations?flash=Telegram+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/telegram/disconnect", (req: Request, res: Response) => {
  stopTelegram();
  upsertIntegration("telegram", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Telegram+disconnected");
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

export default router;
