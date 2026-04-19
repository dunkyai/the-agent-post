import { Router, Request, Response } from "express";
import { getSetting, setSetting } from "../services/db";
import { researchUser, generateContext } from "../services/ai";

const router = Router();

router.get("/getting-started", (req: Request, res: Response) => {
  const agentName = getSetting("agent_name") || "";
  const userName = getSetting("user_name") || "";
  const userEmail = getSetting("user_email") || "";
  const linkedinUrl = getSetting("linkedin_url") || "";
  const contextCompany = getSetting("context_company") || "";
  const contextUser = getSetting("context_user") || "";
  const contextRules = getSetting("context_rules") || "";
  const contextKnowledge = getSetting("context_knowledge") || "";
  const systemPrompt = getSetting("system_prompt") || "";

  // Context completeness: count fields with 20+ chars as "filled" (matches ai.ts threshold)
  const contextFields = [contextCompany, contextUser, contextRules, contextKnowledge];
  const filledCount = contextFields.filter((f) => f.trim().length >= 20).length;

  res.render("getting-started", {
    agentName,
    userName,
    userEmail,
    linkedinUrl,
    contextCompany,
    contextUser,
    contextRules,
    contextKnowledge,
    systemPrompt,
    contextFilled: filledCount,
    contextTotal: contextFields.length,
    flash: req.query.flash || null,
  });
});

router.post("/getting-started", (req: Request, res: Response) => {
  const { agent_name, user_name, user_email, linkedin_url, context_company, context_user, context_rules, context_knowledge, system_prompt } = req.body;

  const trimmedLinkedin = (linkedin_url || "").trim();
  const trimmedCompany = (context_company || "").trim();
  const trimmedUser = (context_user || "").trim();
  const trimmedRules = (context_rules || "").trim();

  setSetting("agent_name", (agent_name || "").trim());
  setSetting("user_name", (user_name || "").trim());
  setSetting("user_email", (user_email || "").trim());
  setSetting("linkedin_url", trimmedLinkedin);
  setSetting("context_company", trimmedCompany);
  setSetting("context_user", trimmedUser);
  setSetting("context_rules", trimmedRules);
  setSetting("context_knowledge", (context_knowledge || "").trim());
  setSetting("system_prompt", (system_prompt || "").trim());

  // If LinkedIn URL is present and context fields are mostly empty, research in background
  const prevLinkedin = getSetting("linkedin_researched_url") || "";
  const contextEmpty = [trimmedCompany, trimmedUser, trimmedRules].filter(f => f.length >= 20).length < 2;
  if (trimmedLinkedin && trimmedLinkedin !== prevLinkedin && contextEmpty) {
    // Fire and forget — runs after response is sent
    (async () => {
      try {
        console.log(`[getting-started] Background LinkedIn research: ${trimmedLinkedin}`);
        const summary = await researchUser(trimmedLinkedin);
        const agentName = getSetting("agent_name") || "";
        const context = await generateContext(summary, agentName);

        if (context.context_company) setSetting("context_company", context.context_company);
        if (context.context_user) setSetting("context_user", context.context_user);
        if (context.context_rules) setSetting("context_rules", context.context_rules);
        setSetting("linkedin_researched_url", trimmedLinkedin);
        console.log(`[getting-started] LinkedIn research complete for ${trimmedLinkedin}`);
      } catch (err: unknown) {
        console.error("[getting-started] Background LinkedIn research failed:", err instanceof Error ? err.message : err);
      }
    })();
  }

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

// GET /getting-started/billing — proxy to provisioning for billing info
router.get("/getting-started/billing", async (req: Request, res: Response) => {
  const instanceId = process.env.INSTANCE_ID;
  const provUrl = process.env.PROVISIONING_URL;
  if (!instanceId || !provUrl) {
    res.json({ error: "Billing not available" });
    return;
  }
  try {
    const r = await fetch(`${provUrl}/instances/${instanceId}/billing`, {
      headers: { Authorization: `Bearer ${process.env.GATEWAY_TOKEN}` },
    });
    const data = await r.json();
    res.json(data);
  } catch (err: any) {
    res.json({ error: err.message || "Failed to load billing" });
  }
});

export default router;
