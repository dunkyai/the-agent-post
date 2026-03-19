import { Router, Request, Response } from "express";
import { getOrCreateConversation, getMessages, deleteConversation, getSetting } from "../services/db";
import { processMessage } from "../services/ai";

const router = Router();

const CHAT_EXTERNAL_ID = "dashboard";

// In-flight request state per session
interface PendingRequest {
  status: string;
  result: { role: string; content: string } | null;
  error: string | null;
  done: boolean;
}
const pending = new Map<string, PendingRequest>();

router.get("/chat", (req: Request, res: Response) => {
  const conversationId = getOrCreateConversation("dashboard", CHAT_EXTERNAL_ID);
  const messages = getMessages(conversationId);

  const agentName = getSetting("agent_name") || "Agent";
  const userName = getSetting("user_name") || "You";

  res.render("chat", { messages, agentName, userName });
});

const REQUEST_TIMEOUT_MS = 180_000; // 3 minutes

// POST: submit a message, returns immediately
router.post("/chat/message", async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const sessionId = req.cookies?.openclaw_session || "anon";
    const state: PendingRequest = { status: "Thinking...", result: null, error: null, done: false };
    pending.set(sessionId, state);

    res.json({ ok: true });

    // Process in background
    const onStatus = (status: string) => {
      state.status = status;
    };

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("__TIMEOUT__")), REQUEST_TIMEOUT_MS)
    );

    try {
      const reply = await Promise.race([
        processMessage("dashboard", CHAT_EXTERNAL_ID, message.trim(), undefined, onStatus),
        timeout,
      ]);
      state.result = { role: "assistant", content: reply };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg === "__TIMEOUT__") {
        console.error("Chat timeout: request exceeded 3 minutes");
        state.error = "That took longer than expected — could you try asking in a simpler way?";
      } else {
        console.error("Chat error:", msg);
        state.error = msg;
      }
    }
    state.done = true;
    // Clean up after 30s
    setTimeout(() => pending.delete(sessionId), 30_000);
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
  const state = pending.get(sessionId);
  if (!state) {
    res.json({ status: "idle", done: true });
    return;
  }
  if (state.done) {
    const result = state.error
      ? { status: "error", error: state.error, done: true }
      : { status: "done", result: state.result, done: true };
    pending.delete(sessionId);
    res.json(result);
    return;
  }
  res.json({ status: state.status, done: false });
});

router.post("/chat/reset", (req: Request, res: Response) => {
  const conversationId = getOrCreateConversation("dashboard", CHAT_EXTERNAL_ID);
  deleteConversation(conversationId);
  res.redirect(303, "/chat");
});

export default router;
