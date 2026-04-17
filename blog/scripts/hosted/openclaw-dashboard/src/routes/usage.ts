import { Router, Request, Response } from "express";
import { getMonthlyTaskCount, getSetting, getDb } from "../services/db";

const router = Router();

router.get("/usage/api", (_req: Request, res: Response) => {
  const used = getMonthlyTaskCount();
  const limit = parseInt(process.env.MESSAGE_LIMIT || "250", 10);
  const plan = process.env.PLAN || "standard";

  // First of next month
  const now = new Date();
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  res.json({ used, limit, plan, resets_at: resetsAt.toISOString() });
});

// Internal analytics endpoint — called by provisioning service for admin dashboard
router.get("/internal/analytics", (req: Request, res: Response) => {
  // Verify request comes from provisioning (same network, gateway token)
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== process.env.GATEWAY_TOKEN) {
    res.sendStatus(401);
    return;
  }

  const db = getDb();
  const now = new Date();
  const startOfMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01 00:00:00`;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");

  // Monthly task count
  const monthlyTasks = getMonthlyTaskCount();

  // Last active timestamp
  const lastActive = (db.prepare(
    "SELECT MAX(created_at) as ts FROM tasks WHERE status = 'completed'"
  ).get() as any)?.ts || null;

  // Tasks by hour (last 30 days)
  const hourlyActivity = db.prepare(
    `SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
     FROM tasks WHERE status = 'completed' AND created_at >= ?
     GROUP BY hour ORDER BY hour`
  ).all(thirtyDaysAgo) as { hour: number; count: number }[];

  // Tasks by day (last 30 days)
  const dailyActivity = db.prepare(
    `SELECT DATE(created_at) as day, COUNT(*) as count
     FROM tasks WHERE status = 'completed' AND created_at >= ?
     GROUP BY day ORDER BY day`
  ).all(thirtyDaysAgo) as { day: string; count: number }[];

  // Top tools used
  const topTools = db.prepare(
    `SELECT tool, COUNT(*) as count FROM task_execution_log
     WHERE created_at >= ? AND tool NOT LIKE 'workflow:%'
     GROUP BY tool ORDER BY count DESC LIMIT 10`
  ).all(thirtyDaysAgo) as { tool: string; count: number }[];

  const agentName = getSetting("agent_name") || "";
  const userName = getSetting("user_name") || "";

  res.json({
    instance_id: process.env.INSTANCE_ID,
    agent_name: agentName,
    user_name: userName,
    plan: process.env.PLAN || "standard",
    message_limit: parseInt(process.env.MESSAGE_LIMIT || "250", 10),
    monthly_tasks: monthlyTasks,
    last_active: lastActive,
    hourly_activity: hourlyActivity,
    daily_activity: dailyActivity,
    top_tools: topTools,
  });
});

export default router;
