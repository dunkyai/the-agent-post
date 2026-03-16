import { Router, Request, Response } from "express";
import { getSetting, setSetting, deleteSetting } from "../services/db";
import { encrypt, decrypt } from "../services/encryption";

const router = Router();

function getProvider(model: string): string {
  if (model.startsWith("claude")) return "anthropic";
  return "openai";
}

function hasValidKey(settingName: string): boolean {
  try {
    const raw = getSetting(settingName);
    if (!raw) return false;
    return !!decrypt(raw).trim();
  } catch {
    return false;
  }
}

router.get("/settings", (req: Request, res: Response) => {
  const hasAnthropicKey = hasValidKey("anthropic_api_key");
  const hasOpenaiKey = hasValidKey("openai_api_key");
  const model = getSetting("model") || "claude-sonnet-4-20250514";
  const agentName = getSetting("agent_name") || "";
  const userName = getSetting("user_name") || "";
  const systemPrompt = getSetting("system_prompt") || "";
  const temperature = getSetting("temperature") || "0.7";
  const maxTokens = getSetting("max_tokens") || "4096";
  const sessionExpiryDays = getSetting("session_expiry_days") || "30";

  res.render("settings", {
    hasAnthropicKey,
    hasOpenaiKey,
    model,
    provider: getProvider(model),
    agentName,
    userName,
    systemPrompt,
    temperature,
    maxTokens,
    sessionExpiryDays,
    flash: req.query.flash || null,
  });
});

router.post("/settings", (req: Request, res: Response) => {
  const { provider, api_key, model, agent_name, user_name, system_prompt, temperature, max_tokens, session_expiry_days } = req.body;

  // Reject empty submissions — require at least the provider field from the form
  if (!provider) {
    res.redirect(303, "/settings?flash=Invalid+submission");
    return;
  }

  // Save API key to the correct provider setting
  if (api_key && api_key.trim() && !api_key.startsWith("••••")) {
    const keyName = provider === "anthropic" ? "anthropic_api_key" : "openai_api_key";
    setSetting(keyName, encrypt(api_key.trim()));
  }

  if (model) {
    setSetting("model", model);
  }

  setSetting("agent_name", (agent_name || "").trim());
  setSetting("user_name", (user_name || "").trim());
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

  res.redirect(303, "/settings?flash=Settings+saved");
});

// Redirect old /agent routes to /settings
router.get("/agent", (_req: Request, res: Response) => {
  res.redirect("/settings");
});
router.post("/agent", (_req: Request, res: Response) => {
  res.redirect(303, "/settings");
});

export default router;
