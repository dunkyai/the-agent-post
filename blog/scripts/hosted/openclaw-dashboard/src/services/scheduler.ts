import { getDueJobs, getScheduledJob, markJobRun, updateScheduledJob, deleteScheduledJob, deleteConversation, getOrCreateConversation, getSetting, cleanupMemories } from "./db";
import { processMessage } from "./ai";
import { getNextRun } from "./cron";
import { getPendingTasks, markStuckTasksFailed, deactivateOldTasks } from "./task";
import { processTask } from "./processor";
import { routeTaskOutput } from "./router";
import { updateChatStatus } from "../adapters/chat";
import { cleanupStaleThreads } from "../adapters/email";
import { logActivity, cleanOldActivityLogs } from "./db";

let tickInterval: ReturnType<typeof setInterval> | null = null;
let lastDeactivateCheck = 0;

// Track tasks currently being processed to avoid double-pickup
const activeTasks = new Set<string>();
const MAX_CONCURRENT_TASKS = 3;

const TICK_INTERVAL_MS = 500; // 500ms — fast task pickup, negligible cost (just a SQLite query)
const DEACTIVATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Guard for cron jobs (still sequential)
let isRunningCron = false;

export function startScheduler(): void {
  if (tickInterval) return;

  // On startup: mark stuck "processing" tasks as failed and save a message to their conversations
  const { getDb, addMessage } = require("./db");
  const stuckTasks = getDb().prepare(
    "SELECT task_id, conversation_id, input FROM tasks WHERE status = 'processing'"
  ).all() as { task_id: string; conversation_id: string | null; input: string }[];

  const stuck = markStuckTasksFailed();
  if (stuck > 0) {
    console.log(`[scheduler] Marked ${stuck} stuck processing task(s) as failed on startup`);
    // Save a user-visible message so the result appears in the thread
    for (const t of stuckTasks) {
      if (t.conversation_id) {
        try {
          addMessage(t.conversation_id, "assistant", "Sorry, this request was interrupted by a system restart. Please try again.");
        } catch {}
      }
    }
  }

  console.log(`Scheduler started (${TICK_INTERVAL_MS / 1000}s tick, max ${MAX_CONCURRENT_TASKS} concurrent tasks)`);
  tick();
  tickInterval = setInterval(() => tick(), TICK_INTERVAL_MS);
}

export function getActiveTaskCount(): number {
  return activeTasks.size;
}

export function stopScheduler(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
    console.log("Scheduler stopped");
  }
}

export function isSchedulerRunning(): boolean {
  return tickInterval !== null;
}

async function tick(): Promise<void> {
  try {
    // 1. Process pending tasks — pick up new ones if we have capacity
    const availableSlots = MAX_CONCURRENT_TASKS - activeTasks.size;
    if (availableSlots > 0) {
      const pendingTasks = getPendingTasks();
      const newTasks = pendingTasks.filter(t => !activeTasks.has(t.task_id));

      for (const task of newTasks.slice(0, availableSlots)) {
        activeTasks.add(task.task_id);
        console.log(`[scheduler] Processing task ${task.task_id} (${task.input.source_channel}) [${activeTasks.size}/${MAX_CONCURRENT_TASKS} active]`);

        // Fire and forget — each task runs independently
        processTaskAsync(task);
      }
    }

    // 2. Process due cron jobs (sequential, guarded separately)
    if (!isRunningCron) {
      isRunningCron = true;
      try {
        const dueJobs = getDueJobs();
        for (const job of dueJobs) {
          await executeJob(job.id);
        }
      } finally {
        isRunningCron = false;
      }
    }

    // 3. Periodic cleanup: deactivate old tasks (once per day)
    const now = Date.now();
    if (now - lastDeactivateCheck > DEACTIVATE_INTERVAL_MS) {
      lastDeactivateCheck = now;
      const deactivated = deactivateOldTasks(1);
      if (deactivated > 0) {
        console.log(`[scheduler] Deactivated ${deactivated} old task(s)`);
      }
      cleanupStaleThreads();

      // Memory cleanup: deduplicate and remove operational logs
      try {
        const cleaned = cleanupMemories();
        if (cleaned > 0) {
          console.log(`[scheduler] Cleaned up ${cleaned} duplicate/operational memories`);
        }
      } catch (err) {
        console.error("[scheduler] Memory cleanup error:", err instanceof Error ? err.message : err);
      }

      // Activity log cleanup: prune entries older than 7 days
      try {
        const pruned = cleanOldActivityLogs();
        if (pruned > 0) {
          console.log(`[scheduler] Pruned ${pruned} old activity log entries`);
        }
      } catch {}

    }
  } catch (err: unknown) {
    console.error("Scheduler tick error:", err instanceof Error ? err.message : err);
  }
}

async function processTaskAsync(task: ReturnType<typeof getPendingTasks>[0]): Promise<void> {
  try {
    const onStatus = (status: string) => {
      if (task.input.source_channel === "chat") {
        updateChatStatus(task.task_id, status);
      }
    };

    const completedTask = await processTask(task, onStatus);
    routeTaskOutput(completedTask);

    // Log task completion
    const status = completedTask.status || "completed";
    const level = status === "failed" ? "error" : "info";
    const summary = status === "failed"
      ? `Task failed: ${completedTask.output?.error || "unknown error"}`
      : `Task completed (${task.input.source_channel})`;
    logActivity({
      type: "task",
      level,
      source: task.input.source_channel || "unknown",
      summary,
      task_id: task.task_id,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] Task ${task.task_id} uncaught error:`, msg);
    logActivity({
      type: "error",
      level: "error",
      source: task.input.source_channel || "scheduler",
      summary: `Task ${task.task_id} uncaught error`,
      detail: msg,
      task_id: task.task_id,
    });
  } finally {
    activeTasks.delete(task.task_id);
  }
}

export async function runJobNow(jobId: number): Promise<void> {
  const job = getScheduledJob(jobId);
  if (!job) throw new Error("Job not found");
  // Run even if disabled — user explicitly asked for it
  console.log(`[scheduler] Manual run triggered for job #${jobId}: ${job.name}`);
  await executeJob(jobId, true);
}

async function executeJob(jobId: number, force = false): Promise<void> {
  const job = getScheduledJob(jobId);
  if (!job || (!job.enabled && !force)) return;

  console.log(`Executing scheduled job #${job.id}: ${job.name}`);

  // Clear conversation history so the AI starts fresh each run.
  // Without this, models (especially GPT-4o) copy previous responses
  // instead of actually calling tools to gather real data.
  // Use a job-specific conversation key so jobs never share conversations,
  // even when they deliver to the same Slack channel or email address.
  const jobConvKey = `job:${job.id}`;
  try {
    const existingConvId = getOrCreateConversation("scheduled_job", jobConvKey);
    deleteConversation(existingConvId);
  } catch {}

  try {
    // Build context — base instructions always present
    let extraContext = `This is a scheduled job execution. Job name: "${job.name}". Schedule: ${job.schedule}. IMPORTANT: You MUST use your tools (gmail_search, calendar_list_events, etc.) to gather real, current data before responding. Do NOT generate information from memory or previous responses — always call the relevant tools first and base your response entirely on their results. If a tool returns no data, say so honestly rather than inventing content.`;

    // For Slack-targeted jobs: fetch recent channel history and enforce output rules
    let slackBrevityRule = "";
    if (job.target_source === "slack" && job.target_external_id) {
      const { fetchChannelHistory, fetchChannelMembers, SLACK_OUTPUT_RULES } = require("./slack");
      const slackChannelId = job.target_external_id.split(":")[0];
      const channelContext = await fetchChannelHistory(slackChannelId, 100);
      if (channelContext) {
        extraContext += `\n\n[SLACK CHANNEL DATA — This is REAL data from Slack channel ${slackChannelId}. You DO have access to this. Use it to answer the job prompt.]\n${channelContext}\n[End of Slack channel data]`;
      } else {
        extraContext += `\n\n[SLACK CHANNEL DATA — No recent messages found in channel ${slackChannelId}.]`;
      }
      // Fetch channel members if available
      const members = await fetchChannelMembers(slackChannelId);
      if (members) {
        extraContext += `\n\n[SLACK CHANNEL MEMBERS]\n${members}\n[End of channel members]`;
      }
      extraContext += `\n\nYour output will be posted to Slack. ${SLACK_OUTPUT_RULES}`;
      slackBrevityRule = `\n\n[REMINDER: ${SLACK_OUTPUT_RULES}]`;
    }

    const result = await processMessage(
      "scheduled_job",
      jobConvKey,
      job.prompt + slackBrevityRule,
      extraContext,
      undefined,
      { skipMemories: true }
    );

    await deliverResult(job, result);

    if (job.run_once) {
      // One-time job: delete from DB to keep the jobs page clean
      deleteScheduledJob(job.id);
      console.log(`Job #${job.id} completed (one-time). Removed.`);
    } else {
      const tz = getSetting("timezone") || "America/Los_Angeles";
      const nextRun = getNextRun(job.schedule, new Date(), tz);
      markJobRun(job.id, result, null, nextRun.toISOString());
      console.log(`Job #${job.id} completed. Next run: ${nextRun.toISOString()}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Job #${job.id} failed:`, message);

    try {
      const tz = getSetting("timezone") || "America/Los_Angeles";
      const nextRun = getNextRun(job.schedule, new Date(), tz);
      markJobRun(job.id, null, message, nextRun.toISOString());
    } catch {
      markJobRun(job.id, null, message, new Date(Date.now() + 3600000).toISOString());
    }
  }
}

async function deliverResult(
  job: { target_source: string; target_external_id: string; name: string },
  result: string
): Promise<void> {
  if (job.target_source === "dashboard") return;

  if (job.target_source === "slack") {
    try {
      const { sendSlackMessage } = require("./slack");
      // Support composite "channelId:threadTs" format for thread delivery
      const parts = job.target_external_id.split(":");
      const channelId = parts[0];
      const threadTs = parts[1] || undefined;
      await sendSlackMessage(channelId, result, threadTs);
    } catch (err: unknown) {
      console.error(`Job "${job.name}" Slack delivery failed:`, err instanceof Error ? err.message : err);
    }
  } else if (job.target_source === "email") {
    try {
      const { sendEmailMessage } = require("./email");
      await sendEmailMessage(job.target_external_id, `Scheduled: ${job.name}`, result);
    } catch (err: unknown) {
      console.error(`Job "${job.name}" email delivery failed:`, err instanceof Error ? err.message : err);
    }
  }
}
