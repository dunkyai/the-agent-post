import { Router, Request, Response } from "express";
import multer from "multer";
import { getOrCreateConversation, getMessages, deleteConversation, getSetting, getChatThreads, createChatThread, renameChatThread } from "../services/db";
import { submitChatMessage, pollChatStatus, pollChatTasks, clearSessionState } from "../adapters/chat";
import { transcribeAudio } from "../services/transcription";
import { scanBuffer } from "../services/antivirus";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Supported file types for chat uploads
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const AUDIO_TYPES = new Set(["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/x-m4a"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const TEXT_TYPES = new Set(["text/plain", "text/csv", "text/markdown", "text/html", "application/json"]);

const router = Router();

router.get("/chat", (req: Request, res: Response) => {
  let threads = getChatThreads();
  let threadId = req.query.thread as string | undefined;

  // If no thread specified, use most recent or create one
  if (!threadId && threads.length > 0) {
    threadId = threads[0].external_id.replace("chat:", "");
  }

  let messages: any[] = [];
  let conversationId: string | null = null;
  if (threadId) {
    conversationId = getOrCreateConversation("dashboard", `chat:${threadId}`);
    messages = getMessages(conversationId);
  }

  // Migrate legacy "dashboard" conversation into a proper thread
  const legacyConvId = getOrCreateConversation("dashboard", "dashboard");
  const legacyMessages = getMessages(legacyConvId);
  if (legacyMessages.length > 0) {
    // Convert legacy conversation to a thread by updating its external_id
    const legacyThreadId = createChatThread();
    const db = require("../services/db").getDb();
    // Move messages to the new thread's conversation
    const newConvId = getOrCreateConversation("dashboard", `chat:${legacyThreadId}`);
    db.prepare("UPDATE messages SET conversation_id = ? WHERE conversation_id = ?").run(newConvId, legacyConvId);
    // Title from first user message
    const firstMsg = legacyMessages.find((m: any) => m.role === "user");
    if (firstMsg) {
      const title = firstMsg.content.slice(0, 50) + (firstMsg.content.length > 50 ? "..." : "");
      db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, newConvId);
    }
    // Delete the empty legacy conversation
    deleteConversation(legacyConvId);
    // Redirect to the migrated thread
    if (!threadId) {
      threadId = legacyThreadId;
      conversationId = newConvId;
      messages = getMessages(newConvId);
      threads = getChatThreads(); // refresh thread list
    }
  }

  const agentName = getSetting("agent_name") || "Agent";
  const userName = getSetting("user_name") || "You";

  res.render("chat", { messages, agentName, userName, threads, activeThread: threadId || null });
});

// POST: submit a message — creates a task, returns immediately
router.post("/chat/message", (req: Request, res: Response) => {
  try {
    const { message, threadId } = req.body;
    if (!message || !message.trim()) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const sessionId = req.cookies?.openclaw_session || "anon";
    console.log(`[chat] POST from session: ${sessionId.slice(0, 8)}...`);

    // Auto-create a thread if none specified
    let activeThreadId = threadId;
    if (!activeThreadId) {
      activeThreadId = createChatThread();
      console.log(`[chat] Auto-created thread ${activeThreadId}`);
    }

    // Auto-title the thread from the first message if untitled
    const threadConvId = getOrCreateConversation("dashboard", `chat:${activeThreadId}`);
    const existingMessages = getMessages(threadConvId);
    if (existingMessages.length === 0) {
      const title = message.trim().slice(0, 50) + (message.trim().length > 50 ? "..." : "");
      renameChatThread(threadConvId, title);
    }

    const { taskId } = submitChatMessage(sessionId, message.trim(), undefined, activeThreadId);
    console.log(`[chat] Task ${taskId} created for session ${sessionId.slice(0, 8)}...`);

    res.json({ ok: true, taskId, threadId: activeThreadId });
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
  const taskId = req.query.taskId as string | undefined;

  if (taskId) {
    // Multi-task format: return tasks array
    const result = pollChatTasks(sessionId, taskId);
    console.log(`[chat] POLL from ${sessionId.slice(0, 8)}... taskId=${taskId.slice(0, 8)}... -> ${result.tasks.length} task(s)`);
    res.json(result);
  } else {
    // Backward-compat: single-task format
    const result = pollChatStatus(sessionId);
    console.log(`[chat] POLL from ${sessionId.slice(0, 8)}... -> status=${result.status}, done=${result.done}`);
    res.json(result);
  }
});

// POST: submit audio — transcribe then process as a chat message
router.post("/chat/audio", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No audio file" });
      return;
    }

    const transcript = await transcribeAudio(req.file.buffer, req.file.originalname || "recording.webm");
    if (!transcript || !transcript.trim()) {
      res.status(400).json({ error: "Could not transcribe audio" });
      return;
    }

    const sessionId = req.cookies?.openclaw_session || "anon";
    console.log(`[chat] Audio transcribed (${transcript.length} chars) for session ${sessionId.slice(0, 8)}...`);

    const threadId = req.body?.threadId as string | undefined;
    const { taskId } = submitChatMessage(sessionId, transcript.trim(), undefined, threadId);
    res.json({ ok: true, taskId, transcript: transcript.trim() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Transcription failed";
    console.error("Chat audio error:", msg);
    res.status(500).json({ error: msg });
  }
});

// POST: submit message with file attachments
router.post("/chat/upload", upload.array("files", 10), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    const message = (req.body.message || "").trim();

    if (!files?.length && !message) {
      res.status(400).json({ error: "Message or files required" });
      return;
    }

    const sessionId = req.cookies?.openclaw_session || "anon";
    const attachments: { type: string; name: string; content: string; mimeType: string }[] = [];
    let transcribedText = "";

    for (const file of files || []) {
      const mime = file.mimetype;
      const name = file.originalname || "file";

      // Virus scan
      const scanResult = await scanBuffer(file.buffer, name);
      if (!scanResult.safe) {
        res.status(400).json({ error: `File "${name}" was rejected: malware detected (${scanResult.threat})` });
        return;
      }

      if (IMAGE_TYPES.has(mime)) {
        // Images: base64 for Claude vision (cap at 5MB to avoid DB bloat)
        if (file.size > 5 * 1024 * 1024) {
          attachments.push({ type: "text", name, content: `[Image ${name} is too large (${Math.round(file.size / 1024 / 1024)}MB). Max 5MB for vision.]`, mimeType: "text/plain" });
        } else {
          attachments.push({
            type: "image",
            name,
            content: file.buffer.toString("base64"),
            mimeType: mime,
          });
        }
      } else if (AUDIO_TYPES.has(mime)) {
        // Audio: transcribe
        try {
          const transcript = await transcribeAudio(file.buffer, name);
          if (transcript?.trim()) {
            transcribedText += (transcribedText ? "\n\n" : "") + `[Transcription of ${name}]:\n${transcript.trim()}`;
          }
        } catch (err) {
          console.error(`[chat] Failed to transcribe ${name}:`, err);
          attachments.push({ type: "text", name, content: `[Audio file: ${name} — transcription failed]`, mimeType: "text/plain" });
        }
      } else if (VIDEO_TYPES.has(mime)) {
        // Video: extract audio and transcribe
        try {
          const transcript = await transcribeAudio(file.buffer, name);
          if (transcript?.trim()) {
            transcribedText += (transcribedText ? "\n\n" : "") + `[Transcription of video ${name}]:\n${transcript.trim()}`;
          }
        } catch {
          attachments.push({ type: "text", name, content: `[Video file: ${name} — could not process]`, mimeType: "text/plain" });
        }
      } else if (mime === "application/pdf") {
        // PDF: extract as text (basic — first ~50KB)
        const text = file.buffer.toString("utf-8", 0, Math.min(file.buffer.length, 50000));
        const cleaned = text.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/ {3,}/g, " ").trim();
        if (cleaned.length > 100) {
          attachments.push({ type: "text", name, content: `[Content of ${name}]:\n${cleaned}`, mimeType: "text/plain" });
        } else {
          attachments.push({ type: "text", name, content: `[PDF file: ${name} — content could not be extracted as text. Use the pdf_read_text tool on the file if needed.]`, mimeType: "text/plain" });
        }
      } else if (TEXT_TYPES.has(mime) || name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".csv") || name.endsWith(".json")) {
        // Text files: include content directly
        const text = file.buffer.toString("utf-8").slice(0, 50000);
        attachments.push({ type: "text", name, content: `[Content of ${name}]:\n${text}`, mimeType: "text/plain" });
      } else {
        attachments.push({ type: "text", name, content: `[Attached file: ${name} (${mime}, ${Math.round(file.size / 1024)}KB)]`, mimeType: "text/plain" });
      }
    }

    // Build the full message
    const parts: string[] = [];
    if (message) parts.push(message);
    if (transcribedText) parts.push(transcribedText);
    for (const a of attachments.filter(a => a.type === "text")) {
      parts.push(a.content);
    }
    const fullMessage = parts.join("\n\n") || "Please analyze the attached files.";

    // Pass image attachments as metadata for Claude vision
    const imageAttachments = attachments.filter(a => a.type === "image");

    const threadId = req.body?.threadId as string | undefined;
    const { taskId } = submitChatMessage(sessionId, fullMessage, imageAttachments.length > 0 ? imageAttachments : undefined, threadId);
    console.log(`[chat] Upload: ${files?.length || 0} files, ${imageAttachments.length} images, message=${message.length} chars`);

    res.json({ ok: true, taskId, fileCount: files?.length || 0 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Upload failed";
    console.error("Chat upload error:", msg);
    res.status(500).json({ error: msg });
  }
});

// GET: check if there's an in-flight task (for resuming after page navigation)
router.get("/chat/pending", (req: Request, res: Response) => {
  const sessionId = req.cookies?.openclaw_session || "anon";
  const result = pollChatStatus(sessionId);
  if (!result.done || result.status !== "idle") {
    res.json(result);
    return;
  }
  // Check DB for processing/pending tasks from chat
  const db = require("../services/db");
  const row = db.getDb()
    .prepare("SELECT task_id, status FROM tasks WHERE active = 1 AND status IN ('pending', 'processing') AND input LIKE '%\"source_channel\":\"chat\"%' ORDER BY created_at DESC LIMIT 1")
    .get() as { task_id: string; status: string } | undefined;
  if (row) {
    res.json({ status: "Processing...", done: false, taskId: row.task_id, resumed: true });
  } else {
    res.json({ status: "idle", done: true });
  }
});

router.post("/chat/reset", (req: Request, res: Response) => {
  const sessionId = req.cookies?.openclaw_session || "anon";
  const { threadId } = req.body;
  clearSessionState(sessionId);
  if (threadId) {
    const conversationId = getOrCreateConversation("dashboard", `chat:${threadId}`);
    deleteConversation(conversationId);
  } else {
    const conversationId = getOrCreateConversation("dashboard", "dashboard");
    deleteConversation(conversationId);
  }
  res.redirect(303, "/chat");
});

// --- Thread CRUD ---

router.post("/chat/threads", (req: Request, res: Response) => {
  const threadId = createChatThread();
  res.redirect(303, `/chat?thread=${threadId}`);
});

router.get("/chat/threads/api", (req: Request, res: Response) => {
  res.json({ threads: getChatThreads() });
});

router.patch("/chat/threads/:id", (req: Request, res: Response) => {
  const { title } = req.body;
  const threadId = req.params.id as string;
  const conversationId = getOrCreateConversation("dashboard", `chat:${threadId}`);
  renameChatThread(conversationId, title);
  res.json({ ok: true });
});

router.delete("/chat/threads/:id", (req: Request, res: Response) => {
  const threadId = req.params.id as string;
  const conversationId = getOrCreateConversation("dashboard", `chat:${threadId}`);
  deleteConversation(conversationId);
  res.json({ ok: true });
});

export default router;
