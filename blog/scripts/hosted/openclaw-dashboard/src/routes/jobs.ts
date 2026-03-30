import { Router, Request, Response } from "express";
import {
  getAllScheduledJobs, getScheduledJob, createScheduledJob,
  updateScheduledJob, deleteScheduledJob, getSetting,
} from "../services/db";
import { isValidCron, getNextRun, describeCron } from "../services/cron";
import { runJobNow } from "../services/scheduler";
import { getRecentTasks, countActiveTasks } from "../services/task";

const TASK_PAGE_SIZE = 25;
const router = Router();

router.get("/jobs", (req: Request, res: Response) => {
  const jobs = getAllScheduledJobs()
    .filter((j) => !(j.run_once && j.last_run))
    .map((j) => ({
      ...j,
      schedule_description: describeCron(j.schedule),
    }));

  const taskPage = Math.max(1, parseInt(req.query.taskPage as string, 10) || 1);
  const taskTotal = countActiveTasks();
  const taskTotalPages = Math.max(1, Math.ceil(taskTotal / TASK_PAGE_SIZE));
  const tasks = getRecentTasks(TASK_PAGE_SIZE, (taskPage - 1) * TASK_PAGE_SIZE);

  const timezone = getSetting("timezone") || "America/Los_Angeles";
  const tab = req.query.tab === "tasks" ? "tasks" : "jobs";

  res.render("jobs", {
    jobs,
    tasks,
    taskPage,
    taskTotalPages,
    taskTotal,
    tab,
    timezone,
    flash: req.query.flash || null,
  });
});

router.get("/jobs/api", (req: Request, res: Response) => {
  const jobs = getAllScheduledJobs()
    .filter((j) => !(j.run_once && j.last_run))
    .map((j) => ({
      ...j,
      schedule_description: describeCron(j.schedule),
    }));
  const timezone = getSetting("timezone") || "America/Los_Angeles";
  res.json({ jobs, timezone });
});

router.post("/jobs", (req: Request, res: Response) => {
  const { name, schedule, prompt, target_source, target_external_id } = req.body;

  if (!name?.trim() || !schedule?.trim() || !prompt?.trim()) {
    res.redirect(303, "/jobs?flash=Name,+schedule,+and+prompt+are+required");
    return;
  }

  if (!isValidCron(schedule.trim())) {
    res.redirect(303, "/jobs?flash=Invalid+cron+expression");
    return;
  }

  try {
    const tz = getSetting("timezone") || "America/Los_Angeles";
    const nextRun = getNextRun(schedule.trim(), new Date(), tz);
    createScheduledJob({
      name: name.trim(),
      schedule: schedule.trim(),
      prompt: prompt.trim(),
      target_source: target_source?.trim() || "dashboard",
      target_external_id: target_external_id?.trim() || "scheduler",
      created_by: "user",
      next_run: nextRun.toISOString(),
    });
    res.redirect(303, "/jobs?flash=Job+created");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/jobs?flash=" + encodeURIComponent(message));
  }
});

router.post("/jobs/:id/toggle", (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.redirect(303, "/jobs?flash=Job+not+found");
    return;
  }
  const job = getScheduledJob(id);
  if (!job) {
    res.redirect(303, "/jobs?flash=Job+not+found");
    return;
  }

  const newEnabled = job.enabled ? 0 : 1;
  let nextRun = job.next_run;
  if (newEnabled && !nextRun) {
    try {
      const tz = getSetting("timezone") || "America/Los_Angeles";
      nextRun = getNextRun(job.schedule, new Date(), tz).toISOString();
    } catch {}
  }

  updateScheduledJob(id, { enabled: newEnabled, next_run: nextRun || undefined });
  res.redirect(303, "/jobs?flash=Job+" + (newEnabled ? "enabled" : "disabled"));
});

router.post("/jobs/:id/run", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id) || !getScheduledJob(id)) {
    res.redirect(303, "/jobs?flash=Job+not+found");
    return;
  }
  // Run async — don't block the request
  runJobNow(id).catch((err: unknown) => {
    console.error(`Manual job run #${id} failed:`, err instanceof Error ? err.message : err);
  });
  res.redirect(303, "/jobs?flash=Job+running+now…+refresh+in+a+moment+to+see+results");
});

router.post("/jobs/:id/delete", (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id) || !getScheduledJob(id)) {
    res.redirect(303, "/jobs?flash=Job+not+found");
    return;
  }
  deleteScheduledJob(id);
  res.redirect(303, "/jobs?flash=Job+deleted");
});

router.post("/jobs/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id) || !getScheduledJob(id)) {
    res.redirect(303, "/jobs?flash=Job+not+found");
    return;
  }
  const { name, schedule, prompt, target_source, target_external_id } = req.body;

  if (!name?.trim() || !schedule?.trim() || !prompt?.trim()) {
    res.redirect(303, "/jobs?flash=Name,+schedule,+and+prompt+are+required");
    return;
  }

  if (!isValidCron(schedule.trim())) {
    res.redirect(303, "/jobs?flash=Invalid+cron+expression");
    return;
  }

  try {
    const tz = getSetting("timezone") || "America/Los_Angeles";
    const nextRun = getNextRun(schedule.trim(), new Date(), tz);
    const updates: Record<string, any> = {
      name: name.trim(),
      schedule: schedule.trim(),
      prompt: prompt.trim(),
      target_source: target_source?.trim() || "dashboard",
      target_external_id: target_external_id?.trim() || "scheduler",
      next_run: nextRun.toISOString(),
    };
    // "Save & Enable" button submits enabled=1
    if (req.body.enabled !== undefined) {
      updates.enabled = req.body.enabled === "1" ? 1 : 0;
    }
    updateScheduledJob(id, updates);
    const flash = req.body.enabled === "1" ? "Job+updated+and+enabled" : "Job+updated";
    res.redirect(303, "/jobs?flash=" + flash);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/jobs?flash=" + encodeURIComponent(message));
  }
});

export default router;
