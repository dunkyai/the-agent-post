import { Router, Request, Response } from "express";
import { getSetting, setSetting } from "../services/db";
import { researchUser, generateSystemPrompt } from "../services/ai";

const router = Router();

router.get("/getting-started", (req: Request, res: Response) => {
  const agentName = getSetting("agent_name") || "";
  const userName = getSetting("user_name") || "";
  const contextCompany = getSetting("context_company") || "";
  const contextUser = getSetting("context_user") || "";
  const contextRules = getSetting("context_rules") || "";
  const contextKnowledge = getSetting("context_knowledge") || "";

  res.render("getting-started", {
    agentName,
    userName,
    contextCompany,
    contextUser,
    contextRules,
    contextKnowledge,
    flash: req.query.flash || null,
  });
});

router.post("/getting-started", (req: Request, res: Response) => {
  const { agent_name, user_name, context_company, context_user, context_rules, context_knowledge } = req.body;

  setSetting("agent_name", (agent_name || "").trim());
  setSetting("user_name", (user_name || "").trim());
  setSetting("context_company", (context_company || "").trim());
  setSetting("context_user", (context_user || "").trim());
  setSetting("context_rules", (context_rules || "").trim());
  setSetting("context_knowledge", (context_knowledge || "").trim());

  res.redirect(303, "/getting-started?flash=Saved");
});

router.post("/getting-started/research", async (req: Request, res: Response) => {
  try {
    const { linkedin_url } = req.body;
    if (!linkedin_url || typeof linkedin_url !== "string") {
      res.json({ error: "LinkedIn URL is required" });
      return;
    }
    const summary = await researchUser(linkedin_url.trim());
    res.json({ summary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Research failed";
    res.json({ error: message });
  }
});

router.post("/getting-started/generate-prompt", async (req: Request, res: Response) => {
  try {
    const { research, company, role, agent_purpose, tone, agent_name } = req.body;
    const prompt = await generateSystemPrompt({
      research: research || "",
      company: company || "",
      role: role || "",
      agentPurpose: agent_purpose || "",
      tone: tone || "friendly",
      agentName: agent_name || "",
    });
    res.json({ prompt });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    res.json({ error: message });
  }
});

export default router;
