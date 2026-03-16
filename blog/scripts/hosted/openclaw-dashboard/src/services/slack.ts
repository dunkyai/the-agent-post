import crypto from "crypto";
import { processMessage } from "./ai";

// Module state
interface SlackConfig {
  bot_token: string;
  bot_user_id: string;
  team_id: string;
  team_name: string;
}

let slackConfig: SlackConfig | null = null;

// Event deduplication
const recentEventIds = new Set<string>();
const EVENT_DEDUP_TTL = 5 * 60 * 1000; // 5 minutes

// --- OAuth URL ---

export function buildSlackOAuthUrl(): string {
  const clientId = process.env.SLACK_CLIENT_ID;
  const instanceId = process.env.INSTANCE_ID;

  if (!clientId) throw new Error("SLACK_CLIENT_ID not configured");
  if (!instanceId) throw new Error("INSTANCE_ID not configured");

  const statePayload = {
    instance_id: instanceId,
    hmac: crypto
      .createHmac("sha256", process.env.GATEWAY_TOKEN!)
      .update(instanceId)
      .digest("hex"),
  };
  const state = Buffer.from(JSON.stringify(statePayload)).toString("base64url");

  const scopes = [
    "chat:write",
    "channels:history",
    "groups:history",
    "im:history",
    "mpim:history",
    "users:read",
  ].join(",");

  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: "https://api.agents.theagentpost.co/oauth/slack/callback",
    state,
  });

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

// --- Lifecycle ---

export function startSlack(config: SlackConfig): void {
  slackConfig = config;
  console.log(`Slack started (team: ${config.team_name}, bot_user_id: ${config.bot_user_id})`);
}

export function stopSlack(): void {
  slackConfig = null;
  console.log("Slack stopped");
}

export function isSlackRunning(): boolean {
  return slackConfig !== null;
}

export function getSlackConfig(): SlackConfig | null {
  return slackConfig;
}

// --- Event handling ---

function isDuplicateEvent(eventId: string): boolean {
  if (recentEventIds.has(eventId)) return true;
  recentEventIds.add(eventId);
  setTimeout(() => recentEventIds.delete(eventId), EVENT_DEDUP_TTL);
  return false;
}

export async function handleSlackEvent(event: any, eventId: string): Promise<void> {
  if (!slackConfig) return;
  if (isDuplicateEvent(eventId)) return;

  // Only handle regular messages (not subtypes like bot_message, message_changed, etc.)
  if (event.type !== "message" || event.subtype) return;

  const text = event.text;
  if (!text) return;

  const channelId = event.channel;
  const userId = event.user || "unknown";
  // Use thread_ts if replying in a thread, otherwise use message ts to start a new thread
  const threadTs = event.thread_ts || event.ts;
  const externalId = `${channelId}:${userId}`;

  try {
    const reply = await processMessage("slack", externalId, text, "You are responding via Slack. Your replies are automatically posted as threaded replies. Keep messages concise and conversational — Slack is not email.");
    await sendSlackMessage(channelId, reply, threadTs);
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("Slack event processing error:", errMessage);
    await sendSlackMessage(channelId, "Sorry, I encountered an error processing your message.", threadTs).catch(() => {});
  }
}

// --- Channel & user info ---

export async function getChannelMembers(channelId: string): Promise<string> {
  if (!slackConfig) return JSON.stringify({ error: "Slack is not connected" });

  const res = await fetch(`https://slack.com/api/conversations.members?channel=${channelId}&limit=100`, {
    headers: { Authorization: `Bearer ${slackConfig.bot_token}` },
  });
  const data: any = await res.json();
  if (!data.ok) return JSON.stringify({ error: data.error });

  // Look up user names
  const members = [];
  for (const userId of data.members || []) {
    const userRes = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: { Authorization: `Bearer ${slackConfig.bot_token}` },
    });
    const userData: any = await userRes.json();
    if (userData.ok) {
      members.push({
        id: userId,
        name: userData.user.real_name || userData.user.name,
        display_name: userData.user.profile?.display_name || "",
        is_bot: userData.user.is_bot || false,
      });
    } else {
      members.push({ id: userId, name: userId });
    }
  }

  return JSON.stringify({ channel: channelId, members });
}

// --- Sending messages ---

export async function sendSlackMessage(channelOrExternalId: string, text: string, threadTs?: string): Promise<void> {
  if (!slackConfig) throw new Error("Slack is not connected");
  const channelId = channelOrExternalId.split(":")[0];

  const payload: any = { channel: channelId, text };
  if (threadTs) payload.thread_ts = threadTs;

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${slackConfig.bot_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Slack API error (${res.status})`);
  }

  const data: any = await res.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
}
