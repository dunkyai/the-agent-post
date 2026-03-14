import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const COOKIE_NAME = "openclaw_session";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createSession(res: Response): void {
  const token = process.env.GATEWAY_TOKEN!;
  const hash = hashToken(token);
  res.cookie(COOKIE_NAME, hash, {
    httpOnly: true,
    sameSite: "strict",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: "/",
  });
}

export function destroySession(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for public routes
  const publicPaths = ["/login", "/health"];
  if (publicPaths.includes(req.path) || req.path.startsWith("/webhook/")) {
    return next();
  }

  const sessionHash = req.cookies?.[COOKIE_NAME];
  const expectedHash = hashToken(process.env.GATEWAY_TOKEN!);

  if (!sessionHash || sessionHash !== expectedHash) {
    res.redirect("/login");
    return;
  }

  next();
}
