import { Router, Request, Response } from "express";
import { getSetting, setSetting, deleteSetting } from "../services/db";
import { encrypt, decrypt } from "../services/encryption";

const router = Router();

const MODELS = [
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "gpt-4.1", label: "GPT-4.1" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
];

router.get("/settings", (req: Request, res: Response) => {
  const anthropicKey = getSetting("anthropic_api_key");
  const openaiKey = getSetting("openai_api_key");
  const model = getSetting("model") || "claude-sonnet-4-20250514";
  const agentName = getSetting("agent_name") || "";
  const systemPrompt = getSetting("system_prompt") || "";
  const temperature = getSetting("temperature") || "0.7";
  const maxTokens = getSetting("max_tokens") || "1024";

  res.render("settings", {
    hasAnthropicKey: !!anthropicKey,
    hasOpenaiKey: !!openaiKey,
    model,
    models: MODELS,
    agentName,
    systemPrompt,
    temperature,
    maxTokens,
    flash: req.query.flash || null,
  });
});

router.post("/settings", (req: Request, res: Response) => {
  const { anthropic_api_key, openai_api_key, model, agent_name, system_prompt, temperature, max_tokens } = req.body;

  // Only update API keys if a new value was provided (not empty/placeholder)
  if (anthropic_api_key && anthropic_api_key.trim() && !anthropic_api_key.startsWith("••••")) {
    setSetting("anthropic_api_key", encrypt(anthropic_api_key.trim()));
  }

  if (openai_api_key && openai_api_key.trim() && !openai_api_key.startsWith("••••")) {
    setSetting("openai_api_key", encrypt(openai_api_key.trim()));
  }

  if (model) {
    setSetting("model", model);
  }

  setSetting("agent_name", (agent_name || "").trim());
  setSetting("system_prompt", system_prompt || "");

  const temp = parseFloat(temperature);
  if (!isNaN(temp) && temp >= 0 && temp <= 2) {
    setSetting("temperature", String(temp));
  }

  const tokens = parseInt(max_tokens, 10);
  if (!isNaN(tokens) && tokens > 0 && tokens <= 8192) {
    setSetting("max_tokens", String(tokens));
  }

  res.redirect("/settings?flash=Settings+saved");
});

// Redirect old /agent routes to /settings
router.get("/agent", (_req: Request, res: Response) => {
  res.redirect("/settings");
});
router.post("/agent", (_req: Request, res: Response) => {
  res.redirect("/settings");
});

export default router;
