import { Router, Request, Response } from "express";
import { getRecentTasks, getTaskById, getTaskExecutionLog, countActiveTasks } from "../services/task";
import { getSetting } from "../services/db";

const PAGE_SIZE = 25;

const router = Router();

router.get("/tasks", (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const total = countActiveTasks();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tasks = getRecentTasks(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const timezone = getSetting("timezone") || "America/Los_Angeles";
  res.render("tasks", { tasks, timezone, page, totalPages, total });
});

router.get("/tasks/api", (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const total = countActiveTasks();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tasks = getRecentTasks(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const timezone = getSetting("timezone") || "America/Los_Angeles";
  res.json({ tasks, timezone, page, totalPages, total });
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
