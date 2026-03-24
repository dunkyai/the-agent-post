import type { Task } from "../types/task";
import { getConfirmationRules } from "./db";
import { getTaskExecutionLog, updateTaskStatus, getTaskById } from "./task";
import { onTaskComplete as chatOnTaskComplete } from "../adapters/chat";
import { onSlackTaskComplete } from "../adapters/slack";

/**
 * Routes a completed/failed task's output to the appropriate channel.
 */
export function routeTaskOutput(task: Task): void {
  const channel = task.output.reply_channel;

  switch (channel) {
    case "chat":
      chatOnTaskComplete(task);
      break;
    case "slack":
      onSlackTaskComplete(task);
      break;
    case "email":
      // Phase 2: call gmail_create_draft()
      console.log(`[router] Email routing not yet implemented for task ${task.task_id}`);
      break;
    default:
      console.log(`[router] Unknown channel "${channel}" for task ${task.task_id}`);
  }
}

/**
 * Check if any tool calls in a task require confirmation.
 * Returns the matching rule description if confirmation is needed, null otherwise.
 */
export function requiresConfirmation(task: Task): string | null {
  const rules = getConfirmationRules();
  if (rules.length === 0) return null;

  const log = getTaskExecutionLog(task.task_id);
  for (const entry of log) {
    for (const rule of rules) {
      const pattern = new RegExp(rule.tool_pattern);
      if (pattern.test(entry.tool)) {
        return rule.description;
      }
    }
  }
  return null;
}

/**
 * Handle confirmation response for a paused task.
 */
export function handleConfirmation(taskId: string, approved: boolean): Task | undefined {
  const task = getTaskById(taskId);
  if (!task || task.status !== "awaiting_confirmation") return undefined;

  if (approved) {
    // Resume — mark as completed so router delivers it
    updateTaskStatus(taskId, "completed");
    return getTaskById(taskId);
  } else {
    updateTaskStatus(taskId, "cancelled");
    return getTaskById(taskId);
  }
}
