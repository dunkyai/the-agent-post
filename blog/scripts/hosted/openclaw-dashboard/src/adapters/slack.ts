import type { Task } from "../types/task";
import { createTask } from "../services/task";
import { getOrCreateConversation } from "../services/db";
import { sendSlackMessage } from "../services/slack";

export interface SlackMessageParams {
  text: string;
  channelId: string;
  threadTs: string;
  userId: string;
  context: string;
}

/**
 * Submit a Slack message as a task — creates a task with status "pending".
 * The scheduler picks it up within ~2s.
 *
 * Pre-processing (audio transcription, @mention filtering, conversation reset,
 * immediate ack) is handled by handleSlackEvent() in slack.ts BEFORE this is called.
 */
export function submitSlackMessage(params: SlackMessageParams): Task {
  const { text, channelId, threadTs, userId, context } = params;
  const externalId = `${channelId}:${threadTs}`;
  const conversationId = getOrCreateConversation("slack", externalId);

  const task = createTask({
    raw_input: text,
    source_channel: "slack",
    reply_channel: "slack",
    metadata: { channelId, threadTs, userId, context },
    conversation_id: conversationId,
  });

  console.log(`[slack-adapter] Task ${task.task_id} created for ${externalId}`);
  return task;
}

/**
 * Called by the output router when a Slack task completes.
 * Sends the result back to the correct Slack channel + thread.
 */
export async function onSlackTaskComplete(task: Task): Promise<void> {
  const channelId = task.input.metadata?.channelId as string | undefined;
  const threadTs = task.input.metadata?.threadTs as string | undefined;

  if (!channelId) {
    console.error(`[slack-adapter] Task ${task.task_id} has no channelId in metadata, cannot route`);
    return;
  }

  try {
    if (task.status === "completed" && task.output.result) {
      await sendSlackMessage(channelId, task.output.result, threadTs);
    } else if (task.status === "failed") {
      await sendSlackMessage(channelId, "Sorry, I ran into an error processing that.", threadTs);
    }
    console.log(`[slack-adapter] Task ${task.task_id} delivered to ${channelId}:${threadTs || "top"}`);
  } catch (err: unknown) {
    console.error(`[slack-adapter] Failed to deliver task ${task.task_id}:`, err instanceof Error ? err.message : err);
  }
}
