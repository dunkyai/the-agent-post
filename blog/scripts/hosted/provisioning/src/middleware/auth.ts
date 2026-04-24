import type { Request, Response, NextFunction } from "express";

// Routes that handle their own auth via instance gateway token
const SELF_AUTH_PATTERNS = [/\/sandbox\//, /\/browser\//, /\/magic-link/, /\/verify-session-code/, /\/billing$/];

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip for routes that do their own per-instance auth
  if (SELF_AUTH_PATTERNS.some((p) => p.test(req.path))) {
    next();
    return;
  }

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
