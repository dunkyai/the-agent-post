import crypto from "crypto";
import { processMessage } from "./ai";
import { getSetting, getOrCreateConversation, deleteConversation } from "./db";
import { decrypt } from "./encryption";
import { isSlackAudioFile, isAudioMimeType, transcribeAudio } from "./transcription";

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
    "files:read",
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

  // Handle regular messages and file_share (for audio files)
  if (event.type !== "message") return;
  if (event.subtype && event.subtype !== "file_share") return;

  let text = event.text || "";

  // Log all files for debugging
  if (event.files?.length > 0) {
    for (const f of event.files) {
      console.log(`Slack file: name=${f.name} mimetype=${f.mimetype} filetype=${f.filetype} subtype=${f.subtype} size=${f.size}`);
    }
  }

  // Check for audio/voice files attached to the event
  const audioFiles = (event.files || []).filter((f: any) => isSlackAudioFile(f));
  if (audioFiles.length > 0) {
    const transcriptions = await transcribeSlackAudioFiles(audioFiles);
    if (transcriptions) {
      text = transcriptions + (text ? "\n\n" + text : "");
    }
  }

  // Check for Slack file URLs pasted as text (user sharing audio links instead of uploading)
  if (audioFiles.length === 0 && slackConfig) {
    const slackFileUrls = text.match(/https?:\/\/[a-z0-9]+\.slack\.com\/files\/[^\s>|]+/g);
    if (slackFileUrls?.length) {
      const urlTranscriptions = await transcribeSlackFileUrls(slackFileUrls);
      if (urlTranscriptions) {
        text = urlTranscriptions + "\n\n" + text;
      }
    }
  }

  if (!text) return;

  const channelId = event.channel;
  const userId = event.user || "unknown";
  // Use thread_ts if replying in a thread, otherwise use message ts to start a new thread
  const threadTs = event.thread_ts || event.ts;
  // Each thread gets its own conversation context; top-level messages start a new one
  const externalId = `${channelId}:${threadTs}`;

  // Only respond if: bot is @mentioned, it's a DM, or audio files were shared in a thread
  const isMentioned = text.includes(`<@${slackConfig.bot_user_id}>`);
  const isDM = channelId.startsWith("D");
  const hasAudioInThread = audioFiles.length > 0 && !!event.thread_ts;
  if (!isMentioned && !isDM && !hasAudioInThread) {
    return;
  }
  console.log(`Slack event: channel=${channelId} user=${userId} mentioned=${isMentioned} dm=${isDM} thread=${!!event.thread_ts}`);

  // Strip the bot mention from the text so the AI sees clean input
  text = text.replace(new RegExp(`<@${slackConfig.bot_user_id}>`, "g"), "").trim();
  if (!text && audioFiles.length === 0) return;

  // Handle conversation reset commands
  const resetPattern = /^(reset|start over|new (project|conversation|chat|topic)|clear (history|context|conversation))$/i;
  if (resetPattern.test(text.trim())) {
    try {
      const convId = getOrCreateConversation("slack", externalId);
      deleteConversation(convId);
      await sendSlackMessage(channelId, "Conversation cleared! Starting fresh.", threadTs);
    } catch {}
    return;
  }

  try {
    // Acknowledge immediately so user knows bot is working
    const acks = ["On it!", "Working on it!", "Let me look into that.", "Give me a moment..."];
    const ack = acks[Math.floor(Math.random() * acks.length)];
    await sendSlackMessage(channelId, ack, threadTs);

    const reply = await processMessage("slack", externalId, text, "You are responding via Slack. IMPORTANT: Do NOT use the send_slack tool to reply to this conversation — just return your reply text and it will be automatically posted as a threaded reply. Only use send_slack to message OTHER channels. Be BRIEF. This is Slack, not email — keep replies short (1-3 sentences when possible). No preamble, no filler, no restating the question. Lead with the answer. Only elaborate if the user asks for more detail. Always follow the user's formatting and style preferences (e.g. if they ask for no emojis, stop using emojis). IMPORTANT: You CAN handle audio files and voice clips in Slack. When a user shares audio, the system automatically transcribes it before you see the message — the transcribed text appears as [Audio transcription: ...] at the start of the message. You do NOT need to access files directly; transcription is handled for you. If asked whether you can process audio, say YES.");
    await sendSlackMessage(channelId, reply, threadTs);
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("Slack event processing error:", errMessage);
    await sendSlackMessage(channelId, "Sorry, I encountered an error processing your message.", threadTs).catch(() => {});
  }
}

async function transcribeSlackAudioFiles(files: any[]): Promise<string> {
  // Prefer Groq (free, via env var); fall back to OpenAI API key from settings
  const hasGroq = !!process.env.GROQ_API_KEY;
  let openaiKey: string | undefined;

  if (!hasGroq) {
    const encryptedKey = getSetting("openai_api_key");
    if (!encryptedKey) {
      console.log("Audio file detected but no transcription API key available (set GROQ_API_KEY or configure OpenAI key in Settings)");
      return "[An audio file was shared, but transcription is unavailable — set GROQ_API_KEY or add an OpenAI API key in Settings.]";
    }
    try {
      openaiKey = decrypt(encryptedKey);
    } catch {
      console.error("Failed to decrypt OpenAI API key for transcription");
      return "[An audio file was shared, but transcription failed — could not load API key.]";
    }
  }

  const parts: string[] = [];
  for (const file of files) {
    try {
      const downloadUrl = file.url_private_download || file.url_private;
      console.log(`Transcribing audio: ${file.name} (${file.mimetype}, filetype=${file.filetype}, ${file.size} bytes) via ${hasGroq ? "Groq" : "OpenAI"}, url=${downloadUrl ? "present" : "MISSING"}`);

      if (!downloadUrl) {
        console.error(`No download URL for Slack file ${file.name}`);
        parts.push(`[Could not download audio file "${file.name}" — no download URL available.]`);
        continue;
      }

      // Download from Slack
      const res = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${slackConfig!.bot_token}` },
      });
      if (!res.ok) {
        console.error(`Failed to download Slack file (${res.status}) from ${downloadUrl}`);
        parts.push(`[Could not download audio file "${file.name}" — you may need to reconnect Slack to grant file access.]`);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const transcript = await transcribeAudio(buffer, file.name, openaiKey);
      parts.push(`[Audio transcription of "${file.name}": "${transcript}"]`);
      console.log(`Transcription complete: ${transcript.length} chars`);
    } catch (err) {
      const errDetail = err instanceof Error ? err.message : String(err);
      console.error(`Transcription error for ${file.name}:`, errDetail);
      parts.push(`[Failed to transcribe audio file "${file.name}". Error: ${errDetail}]`);
    }
  }

  return parts.join("\n");
}

/** Download and transcribe audio files from Slack file URLs pasted as text */
async function transcribeSlackFileUrls(urls: string[]): Promise<string> {
  if (!slackConfig) return "";

  const hasGroq = !!process.env.GROQ_API_KEY;
  let openaiKey: string | undefined;
  if (!hasGroq) {
    const encryptedKey = getSetting("openai_api_key");
    if (!encryptedKey) return "";
    try { openaiKey = decrypt(encryptedKey); } catch { return ""; }
  }

  const parts: string[] = [];
  for (const fileUrl of urls) {
    try {
      // Use Slack API to get file info from the URL
      // Extract file ID from URL pattern: /files/USER_ID/FILE_ID/filename
      const fileIdMatch = fileUrl.match(/\/files\/[A-Z0-9]+\/([A-Z0-9]+)/);
      if (!fileIdMatch) continue;

      const fileId = fileIdMatch[1];
      console.log(`Fetching Slack file info for ${fileId} from URL`);

      const infoRes = await fetch(`https://slack.com/api/files.info?file=${fileId}`, {
        headers: { Authorization: `Bearer ${slackConfig.bot_token}` },
      });
      if (!infoRes.ok) continue;

      const infoData: any = await infoRes.json();
      if (!infoData.ok || !infoData.file) {
        console.error(`Slack files.info failed for ${fileId}: ${infoData.error}`);
        continue;
      }

      const file = infoData.file;
      const audioExts = ["mp3", "mp4", "m4a", "wav", "ogg", "webm", "flac", "aac"];
      const isAudio = (file.mimetype && isAudioMimeType(file.mimetype))
        || audioExts.includes((file.filetype || "").toLowerCase());

      if (!isAudio) {
        console.log(`Slack file ${fileId} is not audio (mimetype=${file.mimetype}, filetype=${file.filetype})`);
        continue;
      }

      const downloadUrl = file.url_private_download || file.url_private;
      if (!downloadUrl) continue;

      console.log(`Downloading audio from URL: ${file.name} (${file.mimetype}, ${file.size} bytes)`);
      const res = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${slackConfig.bot_token}` },
      });
      if (!res.ok) {
        console.error(`Failed to download Slack file from URL (${res.status})`);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const transcript = await transcribeAudio(buffer, file.name || "audio.m4a", openaiKey);
      parts.push(`[Audio transcription of "${file.name}": "${transcript}"]`);
      console.log(`URL transcription complete: ${transcript.length} chars`);
    } catch (err) {
      console.error(`URL transcription error:`, err instanceof Error ? err.message : err);
    }
  }

  return parts.join("\n");
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
