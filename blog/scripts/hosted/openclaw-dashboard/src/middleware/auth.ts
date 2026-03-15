import { Request, Response, NextFunction } from "express";
import { createSessionToken, validateSession, rotateSessionToken, deleteSession } from "../services/db";

const COOKIE_NAME = "openclaw_session";

export function createSession(res: Response): void {
  const token = createSessionToken();
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 90 * 24 * 60 * 60 * 1000, // max possible (90 days) — actual expiry enforced by DB
    path: "/",
  });
}

export function destroySession(req: Request, res: Response): void {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    deleteSession(token);
  }
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for public routes
  const publicPaths = ["/login", "/login/magic-link", "/login/callback", "/health"];
  if (publicPaths.includes(req.path) || req.path.startsWith("/webhook/")) {
    return next();
  }

  const token = req.cookies?.[COOKIE_NAME];
  if (!token || !validateSession(token)) {
    res.redirect("/login");
    return;
  }

  // Auto-rotate token every 24h
  const newToken = rotateSessionToken(token);
  if (newToken) {
    res.cookie(COOKIE_NAME, newToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 90 * 24 * 60 * 60 * 1000,
      path: "/",
    });
  }

  next();
}
