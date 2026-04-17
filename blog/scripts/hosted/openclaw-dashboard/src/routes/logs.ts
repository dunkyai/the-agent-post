import { Router, Request, Response } from "express";
import { getActivityLogs } from "../services/db";

const router = Router();

router.get("/logs", (req: Request, res: Response) => {
  const logs = getActivityLogs({ limit: 200 });
  res.render("logs", { logs, active: "logs", flash: req.query.flash || null });
});

router.get("/logs/api", (req: Request, res: Response) => {
  const type = (req.query.type as string) || "all";
  const since = req.query.since as string | undefined;
  const limit = parseInt(req.query.limit as string, 10) || 200;

  const logs = getActivityLogs({ type, since, limit });
  res.json({ logs });
});

export default router;
