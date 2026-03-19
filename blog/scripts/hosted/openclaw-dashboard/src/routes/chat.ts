import { Router, Request, Response } from "express";
import { getOrCreateConversation, getMessages, deleteConversation, getSetting } from "../services/db";
import { processMessage } from "../services/ai";

const router = Router();

const CHAT_EXTERNAL_ID = "dashboard";

router.get("/chat", (req: Request, res: Response) => {
  const conversationId = getOrCreateConversation("dashboard", CHAT_EXTERNAL_ID);
  const messages = getMessages(conversationId);

  const agentName = getSetting("agent_name") || "Agent";
  const userName = getSetting("user_name") || "You";

  res.render("chat", { messages, agentName, userName });
});

const REQUEST_TIMEOUT_MS = 180_000; // 3 minutes

router.post("/chat/message", async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendEvent = (event: string, data: string) => {
      res.write(`event: ${event}\ndata: ${data}\n\n`);
    };

    sendEvent("status", "Thinking...");

    const onStatus = (status: string) => {
      sendEvent("status", status);
    };

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("__TIMEOUT__")), REQUEST_TIMEOUT_MS)
    );
    const reply = await Promise.race([
      processMessage("dashboard", CHAT_EXTERNAL_ID, message.trim(), undefined, onStatus),
      timeout,
    ]);

    sendEvent("done", JSON.stringify({ role: "assistant", content: reply }));
    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg === "__TIMEOUT__") {
      console.error("Chat timeout: request exceeded 3 minutes");
    } else {
      console.error("Chat error:", msg);
    }
    const errorMsg = msg === "__TIMEOUT__"
      ? "That took longer than expected — could you try asking in a simpler way?"
      : msg;
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: errorMsg })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: errorMsg });
    }
  }
});

router.post("/chat/reset", (req: Request, res: Response) => {
  const conversationId = getOrCreateConversation("dashboard", CHAT_EXTERNAL_ID);
  deleteConversation(conversationId);
  res.redirect(303, "/chat");
});

export default router;
