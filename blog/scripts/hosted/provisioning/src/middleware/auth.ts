import type { Request, Response, NextFunction } from "express";

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const secret = process.env.PROVISIONING_API_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
