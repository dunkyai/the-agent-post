import { getDueJobs, getScheduledJob, markJobRun, deleteConversation, getOrCreateConversation, getSetting } from "./db";
import { processMessage } from "./ai";
import { getNextRun } from "./cron";
import { getPendingTasks, markStuckTasksFailed, deactivateOldTasks } from "./task";
import { processTask } from "./processor";
import { routeTaskOutput } from "./router";
import { updateChatStatus } from "../adapters/chat";

let tickInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;
let lastDeactivateCheck = 0;

const TICK_INTERVAL_MS = 2_000; // 2 seconds
const DEACTIVATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function startScheduler(): void {
  if (tickInterval) return;

  // On startup: mark stuck "processing" tasks as failed
  const stuck = markStuckTasksFailed();
  if (stuck > 0) {
    console.log(`[scheduler] Marked ${stuck} stuck processing task(s) as failed on startup`);
  }

  console.log(`Scheduler started (${TICK_INTERVAL_MS / 1000}s tick)`);
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
  if (isProcessing) return;
  isProcessing = true;

  try {
    // 1. Process pending tasks from the task queue
    const pendingTasks = getPendingTasks();
    for (const task of pendingTasks) {
      console.log(`[scheduler] Processing task ${task.task_id} (${task.input.source_channel})`);

      // Status callback for chat tasks
      const onStatus = (status: string) => {
        if (task.input.source_channel === "chat") {
          updateChatStatus(task.task_id, status);
        }
      };

      const completedTask = await processTask(task, onStatus);
      routeTaskOutput(completedTask);
    }

    // 2. Process due cron jobs (existing behavior)
    const dueJobs = getDueJobs();
    for (const job of dueJobs) {
      await executeJob(job.id);
    }

    // 3. Periodic cleanup: deactivate old tasks (once per day)
    const now = Date.now();
    if (now - lastDeactivateCheck > DEACTIVATE_INTERVAL_MS) {
      lastDeactivateCheck = now;
      const deactivated = deactivateOldTasks(1);
      if (deactivated > 0) {
        console.log(`[scheduler] Deactivated ${deactivated} old task(s)`);
      }
    }
  } catch (err: unknown) {
    console.error("Scheduler tick error:", err instanceof Error ? err.message : err);
  } finally {
    isProcessing = false;
  }
}

async function executeJob(jobId: number): Promise<void> {
  const job = getScheduledJob(jobId);
  if (!job || !job.enabled) return;

  console.log(`Executing scheduled job #${job.id}: ${job.name}`);

  // Clear conversation history so the AI starts fresh each run.
  // Without this, models (especially GPT-4o) copy previous responses
  // instead of actually calling tools to gather real data.
  try {
    const existingConvId = getOrCreateConversation(job.target_source, job.target_external_id);
    deleteConversation(existingConvId);
  } catch {}

  try {
    const result = await processMessage(
      job.target_source,
      job.target_external_id,
      job.prompt,
      `This is a scheduled job execution. Job name: "${job.name}". Schedule: ${job.schedule}. IMPORTANT: You MUST use your tools (gmail_search, calendar_list_events, etc.) to gather real, current data before responding. Do NOT generate information from memory or previous responses — always call the relevant tools first and base your response entirely on their results. If a tool returns no data, say so honestly rather than inventing content.`
    );

    await deliverResult(job, result);

    const tz = getSetting("timezone") || "America/Los_Angeles";
    const nextRun = getNextRun(job.schedule, new Date(), tz);
    markJobRun(job.id, result, null, nextRun.toISOString());
    console.log(`Job #${job.id} completed. Next run: ${nextRun.toISOString()}`);
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
