import { App } from "@slack/bolt";
import { processMessage } from "./ai";

let slackApp: App | null = null;

export async function startSlack(botToken: string, appToken: string): Promise<void> {
  if (slackApp) {
    await stopSlack();
  }

  slackApp = new App({
    token: botToken,
    appToken,
    socketMode: true,
  });

  slackApp.message(async ({ message, say }) => {
    // Only handle regular messages (not bot messages, edits, etc.)
    if (message.subtype) return;
    const text = (message as { text?: string }).text;
    if (!text) return;

    const channelId = message.channel;
    const userId = (message as { user?: string }).user || "unknown";
    const externalId = `${channelId}:${userId}`;

    try {
      const reply = await processMessage("slack", externalId, text);
      await say(reply);
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("Slack error:", errMessage);
      await say("Sorry, I encountered an error processing your message.");
    }
  });

  await slackApp.start();
  console.log("Slack bot started (socket mode)");
}

export async function stopSlack(): Promise<void> {
  if (slackApp) {
    await slackApp.stop();
    slackApp = null;
    console.log("Slack bot stopped");
  }
}

export function isSlackRunning(): boolean {
  return slackApp !== null;
}

export async function sendSlackMessage(channelOrExternalId: string, text: string): Promise<void> {
  if (!slackApp) throw new Error("Slack bot is not running");
  const channelId = channelOrExternalId.split(":")[0];
  await slackApp.client.chat.postMessage({ channel: channelId, text });
}
