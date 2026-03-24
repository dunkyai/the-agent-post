import type { Task } from "../types/task";
import { createTask } from "../services/task";
import { getOrCreateConversation } from "../services/db";

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

/**
 * Submit a chat message — creates a task with status "pending".
 * The scheduler picks it up within ~2s.
 */
export function submitChatMessage(sessionId: string, message: string): { taskId: string } {
  // Cancel any pending cleanup timer from a previous request
  const oldTimer = cleanupTimers.get(sessionId);
  if (oldTimer) clearTimeout(oldTimer);

  // Reuse existing conversation so history persists across messages
  const conversationId = getOrCreateConversation("dashboard", CHAT_EXTERNAL_ID);

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
