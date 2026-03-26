import { getDueJobs, getScheduledJob, markJobRun, updateScheduledJob, deleteConversation, getOrCreateConversation, getSetting } from "./db";
import { processMessage } from "./ai";
import { getNextRun } from "./cron";
import { getPendingTasks, markStuckTasksFailed, deactivateOldTasks } from "./task";
import { processTask } from "./processor";
import { routeTaskOutput } from "./router";
import { updateChatStatus } from "../adapters/chat";
import { cleanupStaleThreads } from "../adapters/email";

let tickInterval: ReturnType<typeof setInterval> | null = null;
let lastDeactivateCheck = 0;

// Track tasks currently being processed to avoid double-pickup
const activeTasks = new Set<string>();
const MAX_CONCURRENT_TASKS = 3;

const TICK_INTERVAL_MS = 2_000; // 2 seconds
const DEACTIVATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Guard for cron jobs (still sequential)
let isRunningCron = false;

export function startScheduler(): void {
  if (tickInterval) return;

  // On startup: mark stuck "processing" tasks as failed
  const stuck = markStuckTasksFailed();
  if (stuck > 0) {
    console.log(`[scheduler] Marked ${stuck} stuck processing task(s) as failed on startup`);
  }

  console.log(`Scheduler started (${TICK_INTERVAL_MS / 1000}s tick, max ${MAX_CONCURRENT_TASKS} concurrent tasks)`);
  tick();
  tickInterval = setInterval(() => tick(), TICK_INTERVAL_MS);
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
  } catch (err: unknown) {
    console.error(`[scheduler] Task ${task.task_id} uncaught error:`, err instanceof Error ? err.message : err);
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
    if (job.target_source === "slack" && job.target_external_id) {
      const { fetchChannelHistory, SLACK_OUTPUT_RULES } = require("./slack");
      const channelContext = await fetchChannelHistory(job.target_external_id);
      if (channelContext) {
        extraContext += `\n\n[Recent Slack channel activity — for context only, do not summarize unless the job requires it]\n${channelContext}\n[End of channel context]`;
      }
      extraContext += `\n\nYour output will be posted to Slack. ${SLACK_OUTPUT_RULES}`;
    }

    const result = await processMessage(
      "scheduled_job",
      jobConvKey,
      job.prompt,
      extraContext,
      undefined,
      { skipMemories: true }
    );

    await deliverResult(job, result);

    if (job.run_once) {
      // One-time job: mark as completed and disable
      markJobRun(job.id, result, null, "");
      updateScheduledJob(job.id, { enabled: 0, next_run: "" });
      console.log(`Job #${job.id} completed (one-time). Auto-disabled.`);
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
      await sendSlackMessage(job.target_external_id, result);
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
