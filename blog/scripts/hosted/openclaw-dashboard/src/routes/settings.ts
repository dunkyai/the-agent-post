import { Router, Request, Response } from "express";
import { getSetting, setSetting, getAllMemories, getAllScheduledJobs, deleteMemory } from "../services/db";

const router = Router();

router.get("/settings", (req: Request, res: Response) => {
  const model = getSetting("model") || "claude-sonnet-4-20250514";
  const systemPrompt = getSetting("system_prompt") || "";
  const temperature = getSetting("temperature") || "0.7";
  const maxTokens = getSetting("max_tokens") || "4096";
  const sessionExpiryDays = getSetting("session_expiry_days") || "30";
  const timezone = getSetting("timezone") || "America/Los_Angeles";
  const memories = getAllMemories();
  const tab = req.query.tab === "memories" ? "memories" : "details";

  res.render("settings", {
    model,
    systemPrompt,
    temperature,
    maxTokens,
    sessionExpiryDays,
    timezone,
    memories,
    tab,
    flash: req.query.flash || null,
  });
});

router.post("/settings", (req: Request, res: Response) => {
  const { model, system_prompt, temperature, max_tokens, session_expiry_days, timezone } = req.body;

  if (model) {
    setSetting("model", model);
  }

  setSetting("system_prompt", system_prompt || "");

  const temp = parseFloat(temperature);
  if (isNaN(temp) || temp < 0 || temp > 2) {
    res.redirect(303, "/settings?flash=Temperature+must+be+between+0+and+2");
    return;
  }
  setSetting("temperature", String(temp));

  const tokens = parseInt(max_tokens, 10);
  if (isNaN(tokens) || tokens < 1 || tokens > 16384) {
    res.redirect(303, "/settings?flash=Max+tokens+must+be+between+1+and+16384");
    return;
  }
  setSetting("max_tokens", String(tokens));

  const validExpiry = ["1", "7", "30", "90"];
  if (validExpiry.includes(session_expiry_days)) {
    setSetting("session_expiry_days", session_expiry_days);
  }

  if (timezone && timezone.trim()) {
    setSetting("timezone", timezone.trim());
  }

  res.redirect(303, "/settings?flash=Settings+saved");
});

// Debug: inspect memories, context, and scheduled jobs
router.get("/settings/debug", (req: Request, res: Response) => {
  const memories = getAllMemories();
  const jobs = getAllScheduledJobs();
  const context = {
    context_company: getSetting("context_company") || "",
    context_user: getSetting("context_user") || "",
    context_rules: getSetting("context_rules") || "",
    context_knowledge: getSetting("context_knowledge") || "",
    system_prompt: getSetting("system_prompt") || "",
  };
  res.json({ memories, context, scheduled_jobs: jobs });
});

// --- Memories management ---
router.get("/memories", (req: Request, res: Response) => {
  res.redirect(301, "/settings?tab=memories");
});

router.post("/memories/:id/delete", (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!isNaN(id)) {
    deleteMemory(id);
  }
  res.redirect(303, "/settings?tab=memories&flash=Memory+deleted");
});

// Redirect old /agent routes to /settings
router.get("/agent", (_req: Request, res: Response) => {
  res.redirect("/settings");
});
router.post("/agent", (_req: Request, res: Response) => {
  res.redirect(303, "/settings");
});

export default router;
