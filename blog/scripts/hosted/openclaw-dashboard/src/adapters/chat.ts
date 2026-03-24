import type { Task } from "../types/task";
import { createTask } from "../services/task";
import { getOrCreateConversation, getSetting, addMessage } from "../services/db";

// --- In-memory pending state (same pattern as old chat.ts) ---

interface PendingState {
  status: string;
  result: { role: string; content: string } | null;
  error: string | null;
  done: boolean;
  taskId: string;
}

const pending = new Map<string, PendingState>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

const CHAT_EXTERNAL_ID = "dashboard";

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

/**
 * Submit a chat message — creates a task with status "pending".
 * The scheduler picks it up within ~2s.
 *
 * Onboarding gate: if context fields are sparse and the user hasn't
 * been asked yet this session, intercept with a canned prompt before
 * the message reaches the AI pipeline.
 */
export function submitChatMessage(sessionId: string, message: string): { taskId: string } {
  // Cancel any pending cleanup timer from a previous request
  const oldTimer = cleanupTimers.get(sessionId);
  if (oldTimer) clearTimeout(oldTimer);

  const conversationId = getOrCreateConversation("dashboard", CHAT_EXTERNAL_ID);

  // --- Onboarding gate ---
  if (isContextSparse() && !onboardingSkipped.has(sessionId)) {
    // First message this session: offer onboarding
    if (!onboardingOffered.has(sessionId)) {
      onboardingOffered.add(sessionId);
      const agentName = getSetting("agent_name") || "your AI assistant";
      const reply = `Hey! Before we dive in, I'd love to learn a bit about you so I can be more helpful. I have a few quick questions — want to go through them, or would you rather skip for now?`;

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
      pending.set(sessionId, state);
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

  // --- Normal flow ---
  const task = createTask({
    raw_input: message,
    source_channel: "chat",
    reply_channel: "chat",
    metadata: { sessionId },
    conversation_id: conversationId,
  });

  const state: PendingState = {
    status: "Thinking...",
    result: null,
    error: null,
    done: false,
    taskId: task.task_id,
  };
  pending.set(sessionId, state);

  console.log(`[chat-adapter] Task ${task.task_id} created for session ${sessionId.slice(0, 8)}...`);
  return { taskId: task.task_id };
}

/**
 * Poll for current status of a chat session's pending request.
 */
export function pollChatStatus(sessionId: string): {
  status: string;
  done: boolean;
  result?: { role: string; content: string };
  error?: string;
  taskId?: string;
} {
  const state = pending.get(sessionId);
  if (!state) {
    return { status: "idle", done: true };
  }
  if (state.done) {
    const result = state.error
      ? { status: "error", error: state.error, done: true, taskId: state.taskId }
      : { status: "done", result: state.result!, done: true, taskId: state.taskId };
    // Clean up immediately on read — client got the result
    pending.delete(sessionId);
    return result;
  }
  return { status: state.status, done: false, taskId: state.taskId };
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

  const state = pending.get(sessionId);
  if (!state || state.taskId !== task.task_id) {
    // Session already cleaned up or different task — ignore
    console.log(`[chat-adapter] No pending state for session ${sessionId.slice(0, 8)}... (task ${task.task_id})`);
    return;
  }

  if (task.status === "completed") {
    state.result = { role: "assistant", content: task.output.result || "" };
  } else if (task.status === "failed") {
    state.error = task.output.error || "Task failed";
  } else {
    // Still in progress — update status
    return;
  }

  state.done = true;
  console.log(`[chat-adapter] Task ${task.task_id} routed to session ${sessionId.slice(0, 8)}...`);

  // Clean up after 30s
  cleanupTimers.set(
    sessionId,
    setTimeout(() => {
      pending.delete(sessionId);
      cleanupTimers.delete(sessionId);
    }, 30_000)
  );
}

/**
 * Update the status message shown during polling.
 * Called by the processor via scheduler.
 */
export function updateChatStatus(taskId: string, status: string): void {
  for (const [, state] of pending) {
    if (state.taskId === taskId && !state.done) {
      state.status = status;
      return;
    }
  }
}
