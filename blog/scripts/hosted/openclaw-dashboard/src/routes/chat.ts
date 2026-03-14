import { Router, Request, Response } from "express";
import { getOrCreateConversation, getMessages } from "../services/db";
import { processMessage } from "../services/ai";

const router = Router();

const CHAT_EXTERNAL_ID = "dashboard";

router.get("/chat", (req: Request, res: Response) => {
  const conversationId = getOrCreateConversation("dashboard", CHAT_EXTERNAL_ID);
  const messages = getMessages(conversationId);

  res.render("chat", { messages });
});

router.post("/chat/message", async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const reply = await processMessage("dashboard", CHAT_EXTERNAL_ID, message.trim());
    res.json({ role: "assistant", content: reply });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Chat error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
