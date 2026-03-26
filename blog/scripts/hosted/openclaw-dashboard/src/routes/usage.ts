import { Router, Request, Response } from "express";
import { getMonthlyTaskCount } from "../services/db";

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

export default router;
