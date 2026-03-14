import { Router, Request, Response } from "express";
import { getSetting, setSetting, deleteSetting } from "../services/db";
import { encrypt, decrypt } from "../services/encryption";

const router = Router();

function getProvider(model: string): string {
  if (model.startsWith("claude")) return "anthropic";
  return "openai";
}

router.get("/settings", (req: Request, res: Response) => {
  const anthropicKey = getSetting("anthropic_api_key");
  const openaiKey = getSetting("openai_api_key");
  const model = getSetting("model") || "claude-sonnet-4-20250514";
  const agentName = getSetting("agent_name") || "";
  const systemPrompt = getSetting("system_prompt") || "";
  const temperature = getSetting("temperature") || "0.7";
  const maxTokens = getSetting("max_tokens") || "4096";

  res.render("settings", {
    hasAnthropicKey: !!anthropicKey,
    hasOpenaiKey: !!openaiKey,
    model,
    provider: getProvider(model),
    agentName,
    systemPrompt,
    temperature,
    maxTokens,
    flash: req.query.flash || null,
  });
});

router.post("/settings", (req: Request, res: Response) => {
  const { provider, api_key, model, agent_name, system_prompt, temperature, max_tokens } = req.body;

  // Save API key to the correct provider setting
  if (api_key && api_key.trim() && !api_key.startsWith("••••")) {
    const keyName = provider === "anthropic" ? "anthropic_api_key" : "openai_api_key";
    setSetting(keyName, encrypt(api_key.trim()));
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
  if (!isNaN(tokens) && tokens > 0 && tokens <= 16384) {
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
