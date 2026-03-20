import { getDueJobs, getScheduledJob, markJobRun, deleteConversation, getOrCreateConversation } from "./db";
import { processMessage } from "./ai";
import { getNextRun } from "./cron";

let tickInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

export function startScheduler(): void {
  if (tickInterval) return;

  console.log("Scheduler started (60s tick)");
  tick();
  tickInterval = setInterval(() => tick(), 60_000);
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
    const dueJobs = getDueJobs();
    for (const job of dueJobs) {
      await executeJob(job.id);
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

    const nextRun = getNextRun(job.schedule, new Date());
    markJobRun(job.id, result, null, nextRun.toISOString());
    console.log(`Job #${job.id} completed. Next run: ${nextRun.toISOString()}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Job #${job.id} failed:`, message);

    try {
      const nextRun = getNextRun(job.schedule, new Date());
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
