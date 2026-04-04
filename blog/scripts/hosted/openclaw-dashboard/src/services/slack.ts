import crypto from "crypto";
import { getSetting, setSetting, getOrCreateConversation, deleteConversation, getDb, expandShortcut, getAllShortcuts, getShortcut, getPendingContinuation, setPendingContinuation, deletePendingContinuation, getWorkflowState } from "./db";
import { submitSlackMessage } from "../adapters/slack";
import { decrypt, encryptOAuthState } from "./encryption";
import { isSlackAudioFile, isAudioMimeType, transcribeAudio } from "./transcription";

// Module state
interface SlackConfig {
  bot_token: string;
  bot_user_id: string;
  team_id: string;
  team_name: string;
}

let slackConfig: SlackConfig | null = null;

// Single source of truth for Slack output formatting — used by both @mention responses and scheduled jobs
export const SLACK_OUTPUT_RULES = "CRITICAL FORMAT RULE: Your response MUST be 3 lines or fewer. No preamble, no filler, no bullet lists, no restating the question. Lead with the answer in plain sentences. Do NOT elaborate unless explicitly asked. Violating this rule makes your response useless — it will be too long for Slack.";

// Event deduplication
const recentEventIds = new Set<string>();
const EVENT_DEDUP_TTL = 5 * 60 * 1000; // 5 minutes

// Track threads where we've already sent the "is this for me?" nudge (persisted in DB)
function hasNudgedThread(externalId: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM slack_nudged_threads WHERE external_id = ?").get(externalId);
}
function markThreadNudged(externalId: string): void {
  getDb().prepare("INSERT OR IGNORE INTO slack_nudged_threads (external_id) VALUES (?)").run(externalId);
}

// --- Approval gate for non-owner users ---

interface PendingApproval {
  taskText: string;
  requesterId: string;
  requesterName: string;
  channelId: string;
  threadTs: string;
  dmChannelId: string;
  dmMessageTs: string;
  context: string;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

const pendingApprovals = new Map<string, PendingApproval>();
const APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getSlackOwnerUserId(): string | null {
  return getSetting("slack_owner_user_id") || null;
}

export function setSlackOwnerUserId(userId: string): void {
  setSetting("slack_owner_user_id", userId);
}

export function isApprovalEnabled(): boolean {
  return getSetting("slack_approval_enabled") === "true";
}

async function openDmChannel(userId: string): Promise<string> {
  if (!slackConfig) throw new Error("Slack is not connected");
  const res = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${slackConfig.bot_token}`,
    },
    body: JSON.stringify({ users: userId }),
  });
  const data: any = await res.json();
  if (!data.ok) throw new Error(`conversations.open failed: ${data.error}`);
  return data.channel.id;
}

async function sendSlackMessageWithTs(channelId: string, text: string, threadTs?: string): Promise<string> {
  if (!slackConfig) throw new Error("Slack is not connected");
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
  if (!res.ok) throw new Error(`Slack API error (${res.status})`);
  const data: any = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return data.ts;
}

async function requestApproval(params: {
  text: string;
  userId: string;
  channelId: string;
  threadTs: string;
  context: string;
}): Promise<void> {
  const ownerUserId = getSlackOwnerUserId();
  if (!ownerUserId || !slackConfig) return;

  const requesterName = await resolveUserName(params.userId);

  // Resolve channel name
  let channelLabel = params.channelId;
  try {
    const res = await fetch(
      `https://slack.com/api/conversations.info?channel=${params.channelId}`,
      { headers: { Authorization: `Bearer ${slackConfig.bot_token}` } }
    );
    const data: any = await res.json();
    if (data.ok && data.channel?.name) channelLabel = `#${data.channel.name}`;
  } catch {}

  const dmChannelId = await openDmChannel(ownerUserId);

  const truncated = params.text.length > 300 ? params.text.slice(0, 300) + "..." : params.text;
  const approvalMsg =
    `*New request from ${requesterName}* (<@${params.userId}>) in ${channelLabel}:\n\n` +
    `> ${truncated.replace(/\n/g, "\n> ")}\n\n` +
    `Reply *approve* or *reject* in this thread.`;

  const dmMessageTs = await sendSlackMessageWithTs(dmChannelId, approvalMsg);

  const timeoutHandle = setTimeout(async () => {
    const pending = pendingApprovals.get(dmMessageTs);
    if (!pending) return;
    pendingApprovals.delete(dmMessageTs);
    await sendSlackMessage(dmChannelId, "This request timed out (24 hours) and was automatically declined.", dmMessageTs).catch(() => {});
    await sendSlackMessage(params.channelId, "Unfortunately, I couldn't get a response, so we'll have to skip on this.", params.threadTs).catch(() => {});
    console.log(`[slack-approval] Request from ${params.userId} timed out`);
  }, APPROVAL_TIMEOUT_MS);

  pendingApprovals.set(dmMessageTs, {
    taskText: params.text,
    requesterId: params.userId,
    requesterName,
    channelId: params.channelId,
    threadTs: params.threadTs,
    dmChannelId,
    dmMessageTs,
    context: params.context,
    timeoutHandle,
  });

  console.log(`[slack-approval] Approval requested for ${requesterName} (${params.userId}) -> DM ${dmMessageTs}`);
}

async function handleApprovalResponse(parentTs: string, responseText: string): Promise<boolean> {
  const pending = pendingApprovals.get(parentTs);
  if (!pending) return false;

  const normalized = responseText.trim().toLowerCase();
  const isApproved = /^(approve|approved|yes|ok|go|do it|go ahead|sure|yep|yeah)\b/i.test(normalized);
  const isRejected = /^(reject|rejected|no|deny|denied|decline|nope|nah|pass)\b/i.test(normalized);

  if (!isApproved && !isRejected) {
    await sendSlackMessage(pending.dmChannelId, "I didn't catch that. Reply *approve* or *reject* in this thread.", parentTs).catch(() => {});
    return true;
  }

  clearTimeout(pending.timeoutHandle);
  pendingApprovals.delete(parentTs);

  if (isApproved) {
    await sendSlackMessage(pending.dmChannelId, `Approved. Processing ${pending.requesterName}'s request now.`, parentTs).catch(() => {});
    await sendSlackMessage(pending.channelId, "Got the green light! Working on it now.", pending.threadTs).catch(() => {});
    submitSlackMessage({
      text: pending.taskText,
      channelId: pending.channelId,
      threadTs: pending.threadTs,
      userId: pending.requesterId,
      context: pending.context,
    });
    console.log(`[slack-approval] Approved request from ${pending.requesterName}`);
  } else {
    await sendSlackMessage(pending.dmChannelId, `Rejected. I'll let ${pending.requesterName} know.`, parentTs).catch(() => {});
    await sendSlackMessage(pending.channelId, "Sorry, I'm not able to help with that right now.", pending.threadTs).catch(() => {});
    console.log(`[slack-approval] Rejected request from ${pending.requesterName}`);
  }

  return true;
}

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
  const state = encryptOAuthState(statePayload);

  const scopes = [
    "chat:write",
    "channels:history",
    "channels:read",
    "groups:history",
    "groups:read",
    "im:history",
    "im:write",
    "mpim:history",
    "users:read",
    "users.profile:read",
    "files:read",
    "files:write",
    "reactions:read",
    "reactions:write",
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

const MAX_DEDUP_SIZE = 10000;

function isDuplicateEvent(eventId: string): boolean {
  if (recentEventIds.has(eventId)) return true;
  if (recentEventIds.size >= MAX_DEDUP_SIZE) recentEventIds.clear();
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

  // Check if this is an approval response (owner replying in DM approval thread)
  if (isDM && event.thread_ts) {
    const handled = await handleApprovalResponse(event.thread_ts, text);
    if (handled) return;
  }

  if (!isMentioned && !isDM && !hasAudioInThread) {
    // If this is a thread the bot has participated in, send a one-time nudge
    if (event.thread_ts && !hasNudgedThread(externalId)) {
      const existing = getDb()
        .prepare("SELECT id FROM conversations WHERE integration_type = 'slack' AND external_id = ?")
        .get(externalId) as { id: string } | undefined;
      if (existing) {
        markThreadNudged(externalId);
        await sendSlackMessage(
          channelId,
          "Is this message meant for me? If so, please include @theagentpost in your ask so that I can take action.",
          event.thread_ts
        ).catch(() => {});
      }
    }
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

  // --- Shortcut help ---
  if (text.trim() === ";" || text.trim().toLowerCase() === ";help") {
    const allShortcuts = getAllShortcuts();
    if (allShortcuts.length > 0) {
      const lines = allShortcuts.map((s) => `\`;${s.trigger}\` — ${s.name}${s.description ? ` (${s.description})` : ""}`);
      const msg = `*Available shortcuts:*\n${lines.join("\n")}\n\nUsage: \`;shortcut your input here\``;
      await sendSlackMessage(channelId, msg, threadTs);
    } else {
      await sendSlackMessage(channelId, "No shortcuts configured yet. Add them on the Shortcuts page in the dashboard.", threadTs);
    }
    return;
  }

  // --- Workflow state check: if this thread has a paused/errored workflow, resume it ---
  const workflowState = getWorkflowState(externalId);
  if (workflowState && (workflowState.status === "paused" || workflowState.status === "prompting" || workflowState.status === "error")) {
    console.log(`[slack] Resuming workflow for thread ${externalId} (status: ${workflowState.status})`);
    // Submit as a workflow resume task — the processor handles the rest
    const shortcut = getShortcut(workflowState.shortcut_id);
    if (shortcut) {
      const acks = ["On it!", "Working on it!", "Let me look into that.", "Give me a moment..."];
      const ack = acks[Math.floor(Math.random() * acks.length)];
      await sendSlackMessage(channelId, ack, threadTs);

      submitSlackMessage({
        text,
        channelId,
        threadTs,
        userId,
        context: `Workflow resume for ;${shortcut.trigger}`,
        metadata: { shortcut_id: shortcut.id, workflow_resume: true },
      });
      return;
    }
  }

  // --- Continuation check: if this thread has a pending Phase 2, run it ---
  let isContinuation = false;
  const pendingCont = getPendingContinuation(externalId);
  if (pendingCont) {
    const shortcut = getShortcut(pendingCont.shortcut_id);
    if (shortcut?.continuation_prompt) {
      deletePendingContinuation(externalId);
      // Expand continuation prompt with the user's reply as input
      let contPrompt = shortcut.continuation_prompt;
      contPrompt = contPrompt.replace(/\{\{input\}\}/g, text);
      text = `[SHORTCUT WORKFLOW: "${shortcut.name}" — Phase 2]\n\n`
        + `The user has reviewed the Phase 1 output and replied. Execute Phase 2 now.\n`
        + `User's reply: "${text}"\n\n`
        + `INSTRUCTIONS:\n${contPrompt}`;
      isContinuation = true;
      console.log(`[slack] Continuation of ;${shortcut.trigger} triggered for thread ${externalId}`);
    }
  }

  // --- Shortcut expansion ---
  const hasAttachments = (event.files || []).length > 0;
  let shortcutMatch = !isContinuation ? expandShortcut(text, hasAttachments) : null;
  let workflowShortcutId: number | undefined;
  if (shortcutMatch) {
    // If this shortcut has workflow_steps, pass shortcut_id to task metadata
    // instead of expanding the prompt — the processor will run the workflow executor
    if (shortcutMatch.shortcut.workflow_steps) {
      workflowShortcutId = shortcutMatch.shortcut.id;
      console.log(`[slack] Workflow shortcut ;${shortcutMatch.shortcut.trigger} detected for user ${userId}`);
      // Don't expand — keep original text as input for the workflow
    } else {
      text = shortcutMatch.expanded;
      console.log(`[slack] Shortcut ;${shortcutMatch.shortcut.trigger} expanded for user ${userId}`);
      // If this shortcut has a continuation, save it for this thread
      if (shortcutMatch.shortcut.continuation_prompt) {
        setPendingContinuation(externalId, shortcutMatch.shortcut.id);
        console.log(`[slack] Pending continuation saved for thread ${externalId}`);
      }
    }
  }

  // --- Approval gate for non-owner users ---
  if (isApprovalEnabled() && !isDM) {
    const ownerUserId = getSlackOwnerUserId();
    if (!ownerUserId) {
      // Auto-claim: first user to @mention becomes the owner
      setSlackOwnerUserId(userId);
      console.log(`[slack-approval] Auto-claimed owner: ${userId}`);
      // Fall through to normal processing — they're the owner
    } else if (userId !== ownerUserId) {
      // Non-owner: route to approval
      try {
        await sendSlackMessage(channelId, "Let me check with my boss on this one. I'll get back to you shortly.", threadTs);

        let threadContext = "";
        if (event.thread_ts) {
          threadContext = await fetchThreadContext(channelId, event.thread_ts, slackConfig.bot_user_id);
        }
        let slackContext = `You are responding via Slack. IMPORTANT: Do NOT use the send_slack tool to reply to this conversation — just return your reply text and it will be automatically posted as a threaded reply. Only use send_slack to message OTHER channels. ${SLACK_OUTPUT_RULES} Always follow the user's formatting and style preferences (e.g. if they ask for no emojis, stop using emojis). IMPORTANT: You CAN handle audio files and voice clips in Slack. When a user shares audio, the system automatically transcribes it before you see the message — the transcribed text appears as [Audio transcription: ...] at the start of the message. You do NOT need to access files directly; transcription is handled for you. If asked whether you can process audio, say YES.`;
        if (threadContext) {
          slackContext += `\n\n[Thread context — all messages in this thread prior to your current request]\n${threadContext}\n[End of thread context]`;
        }

        await requestApproval({ text, userId, channelId, threadTs, context: slackContext });
      } catch (err) {
        // Fail closed: if approval DM fails, don't process the request
        console.error("[slack-approval] Error requesting approval, blocking request:", err instanceof Error ? err.message : err);
        await sendSlackMessage(channelId, "I couldn't reach my admin for approval right now. Please try again in a moment.", threadTs);
        return;
      }
      if (!getSlackOwnerUserId() || userId !== getSlackOwnerUserId()) return;
    }
  }

  try {
    // Acknowledge immediately so user knows bot is working
    const acks = ["On it!", "Working on it!", "Let me look into that.", "Give me a moment..."];
    const ack = acks[Math.floor(Math.random() * acks.length)];
    await sendSlackMessage(channelId, ack, threadTs);

    // Fetch thread context so the agent can see all prior messages in the thread
    let threadContext = "";
    if (event.thread_ts) {
      threadContext = await fetchThreadContext(channelId, event.thread_ts, slackConfig.bot_user_id);
    }

    // Also fetch recent channel history so the agent has broader context
    // (e.g. team updates posted as top-level messages, not in this thread)
    const channelHistory = await fetchChannelHistory(channelId);

    // Create task — scheduler picks it up within ~2s, router delivers reply
    let slackContext = `You are responding via Slack. The user @mentioned you directly — you MUST respond to their message. Your @mention has been removed from the text for cleanliness, but you were explicitly tagged. IMPORTANT: Do NOT use the send_slack tool to reply to this conversation — just return your reply text and it will be automatically posted as a threaded reply. Only use send_slack to message OTHER channels. ${SLACK_OUTPUT_RULES} Always follow the user's formatting and style preferences (e.g. if they ask for no emojis, stop using emojis). IMPORTANT: You CAN handle audio files and voice clips in Slack. When a user shares audio, the system automatically transcribes it before you see the message — the transcribed text appears as [Audio transcription: ...] at the start of the message. You do NOT need to access files directly; transcription is handled for you. If asked whether you can process audio, say YES.`;
    if (channelHistory) {
      slackContext += `\n\n[Recent channel activity — top-level messages in this channel]\n${channelHistory}\n[End of channel activity]`;
    }
    if (threadContext) {
      slackContext += `\n\n[Thread context — all messages in this thread prior to your current request]\n${threadContext}\n[End of thread context]`;
    }
    submitSlackMessage({
      text, channelId, threadTs, userId, context: slackContext,
      ...(workflowShortcutId ? { metadata: { shortcut_id: workflowShortcutId } } : {}),
    });
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("Slack event processing error:", errMessage);
    await sendSlackMessage(channelId, "Sorry, I encountered an error processing your message.", threadTs).catch(() => {});
  }
}

// User ID → display name cache (cleared on restart)
const userNameCache = new Map<string, string>();

async function resolveUserName(userId: string): Promise<string> {
  if (userNameCache.has(userId)) return userNameCache.get(userId)!;
  if (!slackConfig) return userId;
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: { Authorization: `Bearer ${slackConfig.bot_token}` },
    });
    const data: any = await res.json();
    if (data.ok) {
      const name = data.user.profile?.display_name || data.user.real_name || data.user.name || userId;
      userNameCache.set(userId, name);
      return name;
    }
  } catch {}
  userNameCache.set(userId, userId);
  return userId;
}

/**
 * Fetch all messages in a Slack thread and format them as context.
 * Excludes the bot's own messages to avoid noise, but includes
 * everything else so the agent can reference links, text, etc.
 */
async function fetchThreadContext(channelId: string, threadTs: string, botUserId: string): Promise<string> {
  if (!slackConfig) return "";
  try {
    const res = await fetch(
      `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${threadTs}&limit=50`,
      { headers: { Authorization: `Bearer ${slackConfig.bot_token}` } }
    );
    const data: any = await res.json();
    if (!data.ok || !data.messages?.length) return "";

    // Drop the last non-bot message (that's the current request, already the input)
    const threadMessages = data.messages.filter((m: any) => m.user !== botUserId);
    if (threadMessages.length > 0) threadMessages.pop();

    const lines: string[] = [];
    for (const msg of threadMessages) {

      const userName = await resolveUserName(msg.user || "unknown");
      let msgText = msg.text || "";

      // Include file attachments info
      if (msg.files?.length) {
        const fileDescs = msg.files.map((f: any) => {
          const url = f.url_private || f.permalink || "";
          return `[File: ${f.name || f.title || "attachment"} (${f.mimetype || f.filetype || "unknown"})${url ? " " + url : ""}]`;
        });
        msgText = msgText ? `${msgText}\n${fileDescs.join("\n")}` : fileDescs.join("\n");
      }

      // Include link unfurls / attachments
      if (msg.attachments?.length) {
        for (const att of msg.attachments) {
          if (att.title || att.text) {
            const attText = [att.title, att.text].filter(Boolean).join(": ");
            msgText += `\n[Link preview: ${attText}]`;
          }
          if (att.original_url) {
            msgText += `\n[URL: ${att.original_url}]`;
          }
        }
      }

      if (msgText.trim()) {
        lines.push(`${userName}: ${msgText.trim()}`);
      }
    }

    if (lines.length === 0) return "";
    console.log(`[slack] Fetched ${lines.length} thread messages as context for ${channelId}:${threadTs}`);
    return lines.join("\n");
  } catch (err) {
    console.error("[slack] Failed to fetch thread context:", err instanceof Error ? err.message : err);
    return "";
  }
}

/**
 * Fetch recent messages from a Slack channel for context.
 * Used by scheduled jobs to understand recent activity in their target channel.
 */
export async function fetchChannelHistory(channelId: string, limit = 25): Promise<string> {
  if (!slackConfig) return "";
  try {
    const res = await fetch(
      `https://slack.com/api/conversations.history?channel=${channelId}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${slackConfig.bot_token}` } }
    );
    const data: any = await res.json();
    if (!data.ok || !data.messages?.length) return "";

    // conversations.history returns newest-first — reverse for chronological order
    const messages = [...data.messages].reverse();

    const lines: string[] = [];
    for (const msg of messages) {
      if (msg.bot_id || msg.user === slackConfig.bot_user_id) continue;
      if (!msg.text?.trim()) continue;
      const userName = await resolveUserName(msg.user || "unknown");
      lines.push(`${userName}: ${msg.text.trim()}`);
    }

    if (lines.length === 0) return "";
    console.log(`[slack] Fetched ${lines.length} channel messages as context for ${channelId}`);
    return lines.join("\n");
  } catch (err) {
    console.error("[slack] Failed to fetch channel history:", err instanceof Error ? err.message : err);
    return "";
  }
}

async function transcribeSlackAudioFiles(files: any[]): Promise<string> {
  const hasGroq = !!process.env.GROQ_API_KEY;

  // Always try to get OpenAI key as fallback (even when Groq is primary)
  let openaiKey: string | undefined;
  const encryptedKey = getSetting("openai_api_key");
  if (encryptedKey) {
    try { openaiKey = decrypt(encryptedKey); } catch { /* ignore — Groq may still work */ }
  }

  if (!hasGroq && !openaiKey) {
    console.log("Audio file detected but no transcription API key available (set GROQ_API_KEY or configure OpenAI key in Settings)");
    return "[An audio file was shared, but transcription is unavailable — set GROQ_API_KEY or add an OpenAI API key in Settings.]";
  }

  const parts: string[] = [];
  for (const file of files) {
    try {
      const downloadUrl = file.url_private_download || file.url_private;
      const fileSizeMB = (file.size || 0) / (1024 * 1024);
      console.log(`Transcribing audio: ${file.name} (${file.mimetype}, filetype=${file.filetype}, ${fileSizeMB.toFixed(1)}MB) url=${downloadUrl ? "present" : "MISSING"}`);

      if (file.size && file.size > 25 * 1024 * 1024) {
        console.log(`Audio file "${file.name}" is ${fileSizeMB.toFixed(1)}MB — exceeds 25MB limit`);
        parts.push(`[This audio file is too large for me to transcribe. I may have a hippo-sized mouth but can only consume shorter clips. (< 25MB) Please try a different one - thanks!]`);
        continue;
      }

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
  const encryptedKey = getSetting("openai_api_key");
  if (encryptedKey) {
    try { openaiKey = decrypt(encryptedKey); } catch { /* ignore */ }
  }
  if (!hasGroq && !openaiKey) return "";

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
  if (!data.ok) {
    console.error(`[slack] conversations.members error:`, JSON.stringify(data));
    return JSON.stringify({ error: data.error, needed: data.needed, provided: data.provided });
  }

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

  return JSON.stringify({ channel: channelId, members, hint: "To @mention a user in Slack, use <@USER_ID> format (e.g. <@U0ALNN8RZQA>). Never use @DisplayName." });
}

// --- Sending messages ---

export async function sendSlackMessage(channelOrExternalId: string, text: string, threadTs?: string): Promise<void> {
  if (!slackConfig) throw new Error("Slack is not connected");
  let channelId = channelOrExternalId.split(":")[0];

  // For user IDs (U...), open a DM channel first
  if (/^U[A-Z0-9]+$/.test(channelId)) {
    const openRes = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${slackConfig.bot_token}`,
      },
      body: JSON.stringify({ users: channelId }),
    });
    const openData: any = await openRes.json();
    if (openData.ok && openData.channel?.id) {
      channelId = openData.channel.id;
    }
  }

  const payload: any = { channel: channelId, text };
  if (threadTs) payload.thread_ts = threadTs;

  let res = await fetch("https://slack.com/api/chat.postMessage", {
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

  let data: any = await res.json();

  // If DM channel not found, try opening it via conversations.open and retry
  if (!data.ok && data.error === "channel_not_found" && /^D[A-Z0-9]+$/.test(channelId)) {
    console.log(`[slack] channel_not_found for ${channelId}, trying conversations.open fallback`);
    const openRes = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${slackConfig.bot_token}`,
      },
      body: JSON.stringify({ channel: channelId }),
    });
    const openData: any = await openRes.json();
    if (openData.ok && openData.channel?.id) {
      payload.channel = openData.channel.id;
      res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${slackConfig.bot_token}`,
        },
        body: JSON.stringify(payload),
      });
      data = await res.json();
    }
  }

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
}
