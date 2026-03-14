import { Router, Request, Response } from "express";
import { getSetting, setSetting } from "../services/db";

const router = Router();

router.get("/agent", (req: Request, res: Response) => {
  const agentName = getSetting("agent_name") || "";
  const systemPrompt = getSetting("system_prompt") || "";
  const temperature = getSetting("temperature") || "0.7";
  const maxTokens = getSetting("max_tokens") || "1024";

  res.render("agent-config", {
    agentName,
    systemPrompt,
    temperature,
    maxTokens,
    flash: req.query.flash || null,
  });
});

router.post("/agent", (req: Request, res: Response) => {
  const { agent_name, system_prompt, temperature, max_tokens } = req.body;

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

  res.redirect("/agent?flash=Agent+configuration+saved");
});

export default router;
