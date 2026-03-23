import { Router, Request, Response } from "express";
import {
  getAllScheduledJobs, getScheduledJob, createScheduledJob,
  updateScheduledJob, deleteScheduledJob, getSetting,
} from "../services/db";
import { isValidCron, getNextRun, describeCron } from "../services/cron";

const router = Router();

router.get("/jobs", (req: Request, res: Response) => {
  const jobs = getAllScheduledJobs().map((j) => ({
    ...j,
    schedule_description: describeCron(j.schedule),
  }));

  const timezone = getSetting("timezone") || "America/Los_Angeles";

  res.render("jobs", {
    jobs,
    timezone,
    flash: req.query.flash || null,
  });
});

router.get("/jobs/api", (req: Request, res: Response) => {
  const jobs = getAllScheduledJobs().map((j) => ({
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
    updateScheduledJob(id, {
      name: name.trim(),
      schedule: schedule.trim(),
      prompt: prompt.trim(),
      target_source: target_source?.trim() || "dashboard",
      target_external_id: target_external_id?.trim() || "scheduler",
      next_run: nextRun.toISOString(),
    });
    res.redirect(303, "/jobs?flash=Job+updated");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.redirect(303, "/jobs?flash=" + encodeURIComponent(message));
  }
});

export default router;
