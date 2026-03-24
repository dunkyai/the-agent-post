import { Router, Request, Response } from "express";
import { getRecentTasks, getTaskById, getTaskExecutionLog } from "../services/task";
import { getSetting } from "../services/db";

const router = Router();

router.get("/tasks", (req: Request, res: Response) => {
  const tasks = getRecentTasks(100);
  const timezone = getSetting("timezone") || "America/Los_Angeles";
  res.render("tasks", { tasks, timezone });
});

router.get("/tasks/api", (req: Request, res: Response) => {
  const tasks = getRecentTasks(100);
  const timezone = getSetting("timezone") || "America/Los_Angeles";
  res.json({ tasks, timezone });
});

router.get("/tasks/:taskId", (req: Request, res: Response) => {
  const task = getTaskById(req.params.taskId as string);
  if (!task) {
    res.status(404).render("error", { message: "Task not found" });
    return;
  }
  const log = getTaskExecutionLog(task.task_id);
  const timezone = getSetting("timezone") || "America/Los_Angeles";
  res.render("task-detail", { task, log, timezone });
});

router.get("/tasks/:taskId/api", (req: Request, res: Response) => {
  const task = getTaskById(req.params.taskId as string);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const log = getTaskExecutionLog(task.task_id);
  const timezone = getSetting("timezone") || "America/Los_Angeles";
  res.json({ task, log, timezone });
});

export default router;
