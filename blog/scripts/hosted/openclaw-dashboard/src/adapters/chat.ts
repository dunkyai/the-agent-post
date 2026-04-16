import type { Task } from "../types/task";
import { createTask } from "../services/task";
import { getOrCreateConversation, getSetting, addMessage, getDb, expandShortcut, getPendingContinuation, setPendingContinuation, deletePendingContinuation, getShortcut } from "../services/db";

// --- In-memory pending state (supports multiple concurrent tasks per session) ---

interface PendingState {
  status: string;
  result: { role: string; content: string } | null;
  error: string | null;
  done: boolean;
  taskId: string;
}

// sessionId → (taskId → PendingState)
const pending = new Map<string, Map<string, PendingState>>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

const CHAT_CONVERSATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Get or create a chat conversation, starting fresh if the last message
 * was more than 10 minutes ago. Prevents conversation history contamination.
 */
function getChatConversation(): string {
  const existing = getDb()
    .prepare("SELECT id, updated_at FROM conversations WHERE integration_type = 'dashboard' AND external_id = 'dashboard'")
    .get() as { id: string; updated_at: string } | undefined;

  if (existing) {
    const lastActivity = new Date(existing.updated_at + "Z").getTime();
    const now = Date.now();
    if (now - lastActivity > CHAT_CONVERSATION_TIMEOUT_MS) {
      // Stale conversation — archive it by changing its external_id, then create fresh
      const archivedId = `dashboard-${existing.id.slice(0, 8)}`;
      getDb()
        .prepare("UPDATE conversations SET external_id = ? WHERE id = ?")
        .run(archivedId, existing.id);
      console.log(`[chat-adapter] Archived stale conversation ${existing.id.slice(0, 8)} (inactive ${Math.round((now - lastActivity) / 60000)}min)`);
    }
  }

  return getOrCreateConversation("dashboard", "dashboard");
}

// Track onboarding state per session (resets on reboot)
const onboardingOffered = new Set<string>();
const onboardingSkipped = new Set<string>();

const CONTEXT_FIELDS = ["context_company", "context_user", "context_rules", "context_knowledge"];
const CONTEXT_MIN_LENGTH = 20;

function isContextSparse(): boolean {
  return CONTEXT_FIELDS.some((f) => {
    const val = getSetting(f);
    return !val || val.trim().length < CONTEXT_MIN_LENGTH;
  });
}

function looksLikeSkip(msg: string): boolean {
  const lower = msg.toLowerCase().trim();
  return /^(skip|no|nah|not now|later|no thanks|pass)\b/.test(lower);
}

function looksLikeAccept(msg: string): boolean {
  const lower = msg.toLowerCase().trim();
  return /^(yes|yeah|yep|sure|ok|okay|go ahead|let's do it|let's go|absolutely|of course)\b/.test(lower);
}

function getSessionTasks(sessionId: string): Map<string, PendingState> {
  if (!pending.has(sessionId)) pending.set(sessionId, new Map());
  return pending.get(sessionId)!;
}

/**
 * Submit a chat message — creates a task with status "pending".
 * The scheduler picks it up within ~2s.
 *
 * Onboarding gate: if context fields are sparse and the user hasn't
 * been asked yet this session, intercept with a canned prompt before
 * the message reaches the AI pipeline.
 */
export function submitChatMessage(sessionId: string, message: string, imageAttachments?: { name: string; content: string; mimeType: string }[]): { taskId: string } {
  const conversationId = getChatConversation();

  // --- Onboarding gate ---
  if (isContextSparse() && !onboardingSkipped.has(sessionId)) {
    // First message this session: offer onboarding
    if (!onboardingOffered.has(sessionId)) {
      onboardingOffered.add(sessionId);
      const agentName = getSetting("agent_name") || "your AI assistant";
      const reply = `Hey! Before we dive in, I'd love to learn a bit about you so I can be more helpful. Here are a few options:\n\n1. **Answer a few quick questions** — I'll ask one at a time\n2. **Let me research you** — give me your name, company, or LinkedIn URL and I'll look you up\n3. **Skip for now** — we can do this later\n\nWhat would you prefer?`;

      // Save both messages to conversation history
      addMessage(conversationId, "user", message);
      addMessage(conversationId, "assistant", reply);

      const state: PendingState = {
        status: "done",
        result: { role: "assistant", content: reply },
        error: null,
        done: true,
        taskId: "onboarding-gate",
      };
      getSessionTasks(sessionId).set("onboarding-gate", state);
      console.log(`[chat-adapter] Onboarding gate triggered for session ${sessionId.slice(0, 8)}...`);
      return { taskId: "onboarding-gate" };
    }

    // User responded to onboarding offer
    if (looksLikeSkip(message)) {
      onboardingSkipped.add(sessionId);
      console.log(`[chat-adapter] Onboarding skipped by session ${sessionId.slice(0, 8)}...`);
      // Fall through to normal task creation
    }
    // If accepted or anything else, the system prompt onboarding directive handles the rest
  }

  // --- Continuation check: if this session has a pending Phase 2, run it ---
  const contKey = `chat:${sessionId}`;
  const pendingCont = getPendingContinuation(contKey);
  let isContinuation = false;
  let taskInput = message;
  let extraMetadata: Record<string, any> = {};

  if (pendingCont) {
    const shortcut = getShortcut(pendingCont.shortcut_id);
    if (shortcut?.continuation_prompt) {
      deletePendingContinuation(contKey);
      let contPrompt = shortcut.continuation_prompt;
      contPrompt = contPrompt.replace(/\{\{input\}\}/g, message);
      taskInput = `[SHORTCUT WORKFLOW: "${shortcut.name}" — Phase 2]\n\n`
        + `The user has reviewed the Phase 1 output and replied. Execute Phase 2 now.\n`
        + `User's reply: "${message}"\n\n`
        + `INSTRUCTIONS:\n${contPrompt}`;
      isContinuation = true;
      console.log(`[chat-adapter] Continuation of ;${shortcut.trigger} triggered for session ${sessionId.slice(0, 8)}...`);
    }
  }

  // --- Shortcut expansion (only if not a continuation) ---
  let shortcutMatch: ReturnType<typeof expandShortcut> = null;
  if (!isContinuation) {
    shortcutMatch = expandShortcut(message);
    if (shortcutMatch) {
      if (shortcutMatch.shortcut.workflow_steps) {
        // Workflow shortcut — pass shortcut_id, keep original text as input
        extraMetadata = { shortcut_id: shortcutMatch.shortcut.id };
        console.log(`[chat-adapter] Workflow shortcut ;${shortcutMatch.shortcut.trigger} detected for session ${sessionId.slice(0, 8)}...`);
      } else {
        taskInput = shortcutMatch.expanded;
        console.log(`[chat-adapter] Shortcut ;${shortcutMatch.shortcut.trigger} expanded for session ${sessionId.slice(0, 8)}...`);
        // If this shortcut has a continuation_prompt, save it for Phase 2
        if (shortcutMatch.shortcut.continuation_prompt) {
          setPendingContinuation(contKey, shortcutMatch.shortcut.id);
          console.log(`[chat-adapter] Pending continuation saved for session ${sessionId.slice(0, 8)}...`);
        }
      }
    }
  }

  // --- Normal flow ---
  // Shortcuts and continuations get a fresh conversation so prior chat history doesn't bleed in
  const taskConversationId = (shortcutMatch || isContinuation) ? undefined : conversationId;

  const task = createTask({
    raw_input: taskInput,
    source_channel: "chat",
    reply_channel: "chat",
    metadata: {
      sessionId,
      ...extraMetadata,
      ...(imageAttachments?.length ? { images: imageAttachments } : {}),
    },
    conversation_id: taskConversationId,
  });

  const state: PendingState = {
    status: "Thinking...",
    result: null,
    error: null,
    done: false,
    taskId: task.task_id,
  };
  getSessionTasks(sessionId).set(task.task_id, state);

  console.log(`[chat-adapter] Task ${task.task_id} created for session ${sessionId.slice(0, 8)}...`);
  return { taskId: task.task_id };
}

/**
 * Poll for a specific task's status. Returns tasks array format.
 */
export function pollChatTasks(sessionId: string, taskId?: string): {
  tasks: Array<{
    taskId: string;
    status: string;
    done: boolean;
    result?: { role: string; content: string };
    error?: string;
  }>;
} {
  const sessionTasks = pending.get(sessionId);
  if (!sessionTasks || sessionTasks.size === 0) {
    return { tasks: [] };
  }

  const toCheck: [string, PendingState][] = taskId
    ? (sessionTasks.has(taskId) ? [[taskId, sessionTasks.get(taskId)!]] : [])
    : Array.from(sessionTasks.entries());

  const results: Array<{
    taskId: string;
    status: string;
    done: boolean;
    result?: { role: string; content: string };
    error?: string;
  }> = [];

  for (const [tid, state] of toCheck) {
    if (state.done) {
      const entry = state.error
        ? { taskId: tid, status: "error", error: state.error, done: true as const }
        : { taskId: tid, status: "done", result: state.result!, done: true as const };
      results.push(entry);
      // Remove completed task from map on read
      sessionTasks.delete(tid);
    } else {
      results.push({ taskId: tid, status: state.status, done: false });
    }
  }

  // Clean up empty session map
  if (sessionTasks.size === 0) {
    pending.delete(sessionId);
  }

  return { tasks: results };
}

/**
 * Poll for current status of a chat session's pending request.
 * Backward-compatible single-task format.
 */
export function pollChatStatus(sessionId: string): {
  status: string;
  done: boolean;
  result?: { role: string; content: string };
  error?: string;
  taskId?: string;
} {
  const { tasks } = pollChatTasks(sessionId);
  if (tasks.length === 0) {
    return { status: "idle", done: true };
  }
  // Return first done task, or first in-progress task
  const done = tasks.find((t) => t.done);
  if (done) return { ...done };
  return { ...tasks[0] };
}

/**
 * Called by the output router when a task completes.
 * Updates the in-memory pending state so the next poll picks it up.
 */
export function onTaskComplete(task: Task): void {
  // Find which session this task belongs to
  const sessionId = task.input.metadata?.sessionId as string | undefined;
  if (!sessionId) {
    console.log(`[chat-adapter] Task ${task.task_id} has no sessionId, cannot route to chat`);
    return;
  }

  const sessionTasks = pending.get(sessionId);
  if (!sessionTasks) {
    console.log(`[chat-adapter] No pending state for session ${sessionId.slice(0, 8)}... (task ${task.task_id})`);
    return;
  }

  const state = sessionTasks.get(task.task_id);
  if (!state) {
    console.log(`[chat-adapter] No pending state for task ${task.task_id} in session ${sessionId.slice(0, 8)}...`);
    return;
  }

  if (task.status === "completed") {
    state.result = { role: "assistant", content: task.output.result || "" };
  } else if (task.status === "failed") {
    const error = task.output.error || "Task failed";
    if (error === "MESSAGE_LIMIT_REACHED") {
      const limit = process.env.MESSAGE_LIMIT || "250";
      state.result = { role: "assistant", content: `You've used all ${limit} messages for this month. Your limit resets on the 1st.\n\nVisit your **Settings** page to manage your plan.` };
      state.done = true;
      return;
    }
    state.error = error;
  } else {
    // Still in progress — update status
    return;
  }

  state.done = true;
  console.log(`[chat-adapter] Task ${task.task_id} routed to session ${sessionId.slice(0, 8)}...`);

  // Clean up after 30s if client doesn't poll
  const timerKey = `${sessionId}:${task.task_id}`;
  cleanupTimers.set(
    timerKey,
    setTimeout(() => {
      const st = pending.get(sessionId);
      if (st) {
        st.delete(task.task_id);
        if (st.size === 0) pending.delete(sessionId);
      }
      cleanupTimers.delete(timerKey);
    }, 30_000)
  );
}

/**
 * Update the status message shown during polling.
 * Called by the processor via scheduler.
 */
export function updateChatStatus(taskId: string, status: string): void {
  for (const [, sessionTasks] of pending) {
    const state = sessionTasks.get(taskId);
    if (state && !state.done) {
      state.status = status;
      return;
    }
  }
}
