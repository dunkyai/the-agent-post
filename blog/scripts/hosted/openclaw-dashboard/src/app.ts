import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { requireAuth } from "./middleware/auth";

// Routes
import loginRouter from "./routes/login";
import gettingStartedRouter from "./routes/getting-started";
import settingsRouter from "./routes/settings";
import integrationsRouter from "./routes/integrations";
import chatRouter from "./routes/chat";
import healthRouter from "./routes/health";
import webhookRouter from "./routes/webhook";
import jobsRouter from "./routes/jobs";
import tasksRouter from "./routes/tasks";
import bugReportRouter from "./routes/bug-report";
import usageRouter from "./routes/usage";

const app = express();
app.disable("x-powered-by");

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Middleware — capture raw body on webhook routes for signature verification
app.use(express.json({
  verify: (req: any, _res, buf) => {
    if (req.url?.startsWith("/webhook/")) {
      req.rawBody = buf;
    }
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Security headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// Auth middleware (skips /login, /health, /webhook/*)
app.use(requireAuth);

// Routes
app.use(loginRouter);
app.use(gettingStartedRouter);
app.use(settingsRouter);
app.use(integrationsRouter);
app.use(chatRouter);
app.use(healthRouter);
app.use(webhookRouter);
app.use(jobsRouter);
app.use(tasksRouter);
app.use(bugReportRouter);
app.use(usageRouter);

// Root redirect
app.get("/", (_req, res) => {
  res.redirect("/getting-started");
});

export default app;
