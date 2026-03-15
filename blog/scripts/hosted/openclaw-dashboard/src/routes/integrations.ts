import { Router, Request, Response } from "express";
import { getIntegration, upsertIntegration, getAllIntegrations } from "../services/db";
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
  const emailIntegration = integrationMap["email"];
  if (emailIntegration && emailIntegration.status === "connected") {
    try {
      const config = JSON.parse(decrypt(emailIntegration.config));
      emailAddress = config.email_address || null;
    } catch {}
  }

  let googleEmail: string | null = null;
  let googleServices: string[] = [];
  const googleIntegration = integrationMap["google"];
  if (googleIntegration && googleIntegration.status === "connected") {
    try {
      const config = JSON.parse(decrypt(googleIntegration.config));
      googleEmail = config.google_email || null;
      googleServices = config.services || [];
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
    },
    google: {
      ...(integrationMap["google"] || { status: "disconnected", error_message: null }),
      google_email: googleEmail,
      services: googleServices,
    },
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
  // Revoke token at Google (fire-and-forget)
  try {
    const integration = getIntegration("google");
    if (integration && integration.status === "connected") {
      const config = JSON.parse(decrypt(integration.config));
      if (config.refresh_token) {
        fetch(`https://oauth2.googleapis.com/revoke?token=${config.refresh_token}`, {
          method: "POST",
        }).catch(() => {});
      }
    }
  } catch {}

  stopGoogle();
  upsertIntegration("google", "{}", "disconnected");
  res.redirect(303, "/integrations?flash=Google+disconnected");
});

export default router;
