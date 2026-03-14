import { Router, Request, Response } from "express";
import { getIntegration, upsertIntegration, getAllIntegrations } from "../services/db";
import { encrypt, decrypt } from "../services/encryption";
import { startTelegram, stopTelegram, isTelegramRunning } from "../services/telegram";
import { startSlack, stopSlack, isSlackRunning } from "../services/slack";
import { signupAndCreateInbox, createInbox, startEmail, stopEmail, isEmailRunning } from "../services/email";

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

  res.render("integrations", {
    telegram: integrationMap["telegram"] || { status: "disconnected", error_message: null },
    slack: integrationMap["slack"] || { status: "disconnected", error_message: null },
    email: {
      ...(integrationMap["email"] || { status: "disconnected", error_message: null }),
      email_address: emailAddress,
    },
    flash: req.query.flash || null,
  });
});

router.post("/integrations/telegram/connect", async (req: Request, res: Response) => {
  try {
    const { bot_token } = req.body;
    if (!bot_token || !bot_token.trim()) {
      res.redirect("/integrations?flash=Bot+token+is+required");
      return;
    }

    const config = encrypt(JSON.stringify({ bot_token: bot_token.trim() }));
    startTelegram(bot_token.trim());
    upsertIntegration("telegram", config, "connected");
    res.redirect("/integrations?flash=Telegram+connected");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    upsertIntegration("telegram", "{}", "error", message);
    res.redirect("/integrations?flash=Telegram+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/telegram/disconnect", (req: Request, res: Response) => {
  stopTelegram();
  upsertIntegration("telegram", "{}", "disconnected");
  res.redirect("/integrations?flash=Telegram+disconnected");
});

router.post("/integrations/slack/connect", async (req: Request, res: Response) => {
  try {
    const { bot_token, app_token } = req.body;
    if (!bot_token?.trim() || !app_token?.trim()) {
      res.redirect("/integrations?flash=Both+Slack+tokens+are+required");
      return;
    }

    const config = encrypt(
      JSON.stringify({
        bot_token: bot_token.trim(),
        app_token: app_token.trim(),
      })
    );
    await startSlack(bot_token.trim(), app_token.trim());
    upsertIntegration("slack", config, "connected");
    res.redirect("/integrations?flash=Slack+connected");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    upsertIntegration("slack", "{}", "error", message);
    res.redirect("/integrations?flash=Slack+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/slack/disconnect", async (req: Request, res: Response) => {
  await stopSlack();
  upsertIntegration("slack", "{}", "disconnected");
  res.redirect("/integrations?flash=Slack+disconnected");
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
    res.redirect("/integrations?flash=Email+connected:+" + encodeURIComponent(result.emailAddress));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    upsertIntegration("email", "{}", "error", message);
    res.redirect("/integrations?flash=Email+error:+" + encodeURIComponent(message));
  }
});

router.post("/integrations/email/disconnect", (req: Request, res: Response) => {
  stopEmail();
  upsertIntegration("email", "{}", "disconnected");
  res.redirect("/integrations?flash=Email+disconnected");
});

export default router;
