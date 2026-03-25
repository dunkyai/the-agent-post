import { Router, Request, Response } from "express";
import { getSetting, setSetting } from "../services/db";
import { researchUser, generateContext } from "../services/ai";

const router = Router();

router.get("/getting-started", (req: Request, res: Response) => {
  const agentName = getSetting("agent_name") || "";
  const userName = getSetting("user_name") || "";
  const linkedinUrl = getSetting("linkedin_url") || "";
  const contextCompany = getSetting("context_company") || "";
  const contextUser = getSetting("context_user") || "";
  const contextRules = getSetting("context_rules") || "";
  const contextKnowledge = getSetting("context_knowledge") || "";

  // Context completeness: count fields with 20+ chars as "filled" (matches ai.ts threshold)
  const contextFields = [contextCompany, contextUser, contextRules, contextKnowledge];
  const filledCount = contextFields.filter((f) => f.trim().length >= 20).length;

  res.render("getting-started", {
    agentName,
    userName,
    linkedinUrl,
    contextCompany,
    contextUser,
    contextRules,
    contextKnowledge,
    contextFilled: filledCount,
    contextTotal: contextFields.length,
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

// Single endpoint: research LinkedIn → generate context → save to DB → return fields
router.post("/getting-started/research", async (req: Request, res: Response) => {
  try {
    const { linkedin_url } = req.body;
    if (!linkedin_url || typeof linkedin_url !== "string") {
      res.json({ error: "LinkedIn URL is required" });
      return;
    }

    // Step 1: Research LinkedIn profile
    const summary = await researchUser(linkedin_url.trim());

    // Step 2: Generate structured context from research
    const agentName = getSetting("agent_name") || "";
    const context = await generateContext(summary, agentName);

    // Step 3: Save to DB
    setSetting("linkedin_url", linkedin_url.trim());
    if (context.context_company) setSetting("context_company", context.context_company);
    if (context.context_user) setSetting("context_user", context.context_user);
    if (context.context_rules) setSetting("context_rules", context.context_rules);

    res.json({
      summary,
      context_company: context.context_company,
      context_user: context.context_user,
      context_rules: context.context_rules,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Research failed";
    res.json({ error: message });
  }
});

export default router;
