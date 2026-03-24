import { Router, Request, Response } from "express";
import { getOrCreateConversation, getMessages, deleteConversation, getSetting } from "../services/db";
import { submitChatMessage, pollChatStatus } from "../adapters/chat";

const router = Router();

const CHAT_EXTERNAL_ID = "dashboard";

router.get("/chat", (req: Request, res: Response) => {
  const conversationId = getOrCreateConversation("dashboard", CHAT_EXTERNAL_ID);
  const messages = getMessages(conversationId);

  const agentName = getSetting("agent_name") || "Agent";
  const userName = getSetting("user_name") || "You";

  res.render("chat", { messages, agentName, userName });
});

// POST: submit a message — creates a task, returns immediately
router.post("/chat/message", (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const sessionId = req.cookies?.openclaw_session || "anon";
    console.log(`[chat] POST from session: ${sessionId.slice(0, 8)}...`);

    const { taskId } = submitChatMessage(sessionId, message.trim());
    console.log(`[chat] Task ${taskId} created for session ${sessionId.slice(0, 8)}...`);

    res.json({ ok: true, taskId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Chat error:", msg);
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    }
  }
});

// GET: poll for status/result
router.get("/chat/poll", (req: Request, res: Response) => {
  const sessionId = req.cookies?.openclaw_session || "anon";
  const result = pollChatStatus(sessionId);
  console.log(`[chat] POLL from ${sessionId.slice(0, 8)}... -> status=${result.status}, done=${result.done}`);
  res.json(result);
});

router.post("/chat/reset", (req: Request, res: Response) => {
  const conversationId = getOrCreateConversation("dashboard", CHAT_EXTERNAL_ID);
  deleteConversation(conversationId);
  res.redirect(303, "/chat");
});

export default router;
