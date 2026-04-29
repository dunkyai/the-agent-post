import type { Task } from "../types/task";
import { trackTask } from "./agnost";
import {
  getTaskById,
  updateTaskStatus,
  appendExecutionLog,
} from "./task";
import { logActivity } from "./db";
import {
  buildSystemPrompt,
  getProvider,
  getApiKey,
  callAnthropic,
  callOpenAI,
  type ToolCallCallback,
  type SourceContext,
} from "./ai";
import { isGoogleRunning, getConnectedServices } from "./google";
import { isLumaRunning } from "./luma";
import {
  getSetting,
  getOrCreateConversation,
  addMessage,
  getMessages,
  getMonthlyTaskCount,
  getShortcut,
} from "./db";
import { executeWorkflow, resumeWorkflow } from "./workflow";

export type StatusCallback = (status: string) => void;

/**
 * Detect when a user's request could be routed to multiple integrations.
 * Returns a clarification message if ambiguous, null if routing is clear.
 */
function detectRoutingAmbiguity(input: string): string | null {
  // Calendar: both Google Calendar and Luma connected — only when CREATING an event
  const createEventPattern = /\b(create|schedule|set up|book|plan|organize|make)\b.*\b(event|meeting|appointment|invite)\b/i;
  const createEventPattern2 = /\b(event|meeting|appointment|invite)\b.*\b(for|on|at|this|next|tomorrow)\b/i;
  if (createEventPattern.test(input) || createEventPattern2.test(input)) {
    const googleServices = getConnectedServices();
    const hasGoogleCalendar = googleServices?.includes("calendar") ?? false;
    const hasLuma = isLumaRunning();

    if (hasGoogleCalendar && hasLuma) {
      // If user explicitly mentions which one, no ambiguity
      if (/\b(google|gcal|google calendar)\b/i.test(input)) return null;
      if (/\bluma\b/i.test(input)) return null;
      // If user is asking about existing events (check, list, what's on), skip
      if (/\b(check|list|show|what'?s|do i have|any)\b/i.test(input)) return null;

      return "You have both Google Calendar and Luma connected. Which would you like me to use?\n\n" +
        "- **Google Calendar** — personal calendar events\n" +
        "- **Luma** — public events with RSVPs and a landing page";
    }
  }

  return null;
}

export async function processTask(
  task: Task,
  onStatus?: StatusCallback
): Promise<Task> {
  const taskId = task.task_id;

  // Mark as processing
  const startedAt = new Date().toISOString();
  updateTaskStatus(taskId, "processing", {
    execution: JSON.stringify({
      ...task.execution,
      started_at: startedAt,
    }),
  });

  try {
    // Immediate feedback — show status before AI call
    onStatus?.("Understanding your request...");

    const model = getSetting("model") || "claude-sonnet-4-20250514";
    const temperature = parseFloat(getSetting("temperature") || "0.7");
    const maxTokens = parseInt(getSetting("max_tokens") || "4096", 10);

    // Build system prompt with any channel-specific context from metadata
    let extraContext = task.input.metadata?.context as string | undefined;

    // Inject email thread info so the AI can reply on the same thread
    const delivery = task.input.metadata?.delivery as any;
    if (delivery?.details?.thread_id) {
      const threadInfo = `\n\n[EMAIL REPLY CONTEXT] You MUST use these values when sending/drafting the reply to keep it in the same Gmail thread:\n- thread_id: ${delivery.details.thread_id}\n- in_reply_to: ${delivery.details.in_reply_to}\n- subject: ${delivery.details.subject || ""}`;
      extraContext = extraContext ? extraContext + threadInfo : threadInfo;
    }

    const systemPrompt = buildSystemPrompt(extraContext, { userInput: task.input.raw_input });

    const provider = getProvider(model);
    const apiKey = getApiKey(provider);

    // Check monthly usage limit
    const messageLimit = parseInt(process.env.MESSAGE_LIMIT || "250", 10);
    const usedThisMonth = getMonthlyTaskCount();
    if (usedThisMonth >= messageLimit) {
      throw new Error("MESSAGE_LIMIT_REACHED");
    }

    // --- Workflow shortcut branch ---
    const shortcutId = task.input.metadata?.shortcut_id as number | undefined;
    const isWorkflowResume = task.input.metadata?.workflow_resume as boolean | undefined;
    if (shortcutId) {
      const shortcut = getShortcut(shortcutId);
      if (shortcut?.workflow_steps || isWorkflowResume) {
        const threadId = task.input.metadata?.workflow_thread_id as string
          || (task.input.metadata?.threadTs
            ? `${task.input.metadata.channelId}:${task.input.metadata.threadTs}`
            : taskId);
        const userInput = task.input.raw_input;

        const result = isWorkflowResume
          ? await resumeWorkflow(task, threadId, userInput, onStatus)
          : await executeWorkflow(task, shortcut!, threadId, userInput, onStatus);

        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - new Date(startedAt).getTime();
        updateTaskStatus(taskId, result.status === "error" ? "failed" : "completed", {
          output: JSON.stringify({ reply_channel: task.input.source_channel, result: result.response }),
          execution: JSON.stringify({ ...task.execution, started_at: startedAt, completed_at: completedAt, duration_ms: durationMs }),
        });
        return getTaskById(taskId)!;
      }
    }

    // Get or create conversation for this task
    const source = task.input.source_channel;
    const externalId = taskId; // Use task ID as external ID for chat tasks
    const conversationId = task.conversation_id || getOrCreateConversation(source, externalId);

    // Store conversation ID on task
    if (!task.conversation_id) {
      updateTaskStatus(taskId, "processing", {
        conversation_id: conversationId,
      });
    }

    // Add user message
    addMessage(conversationId, "user", task.input.raw_input);

    // Build image content blocks for Claude vision (if images attached)
    const imageAttachments = task.input.metadata?.images as { name: string; content: string; mimeType: string }[] | undefined;

    // Get conversation history
    const MAX_HISTORY = 30;
    const KEEP_RECENT = 6; // Keep last N messages raw, summarize the rest
    let history = getMessages(conversationId).filter(
      (m) => m.content && m.content.trim()
    );

    // Extract sticky context from full history before truncating
    // (doc URLs, image uploads, and other artifacts the AI should always remember)
    const stickyItems: string[] = [];
    for (const msg of history) {
      if (msg.role !== "assistant") continue;
      const content = msg.content || "";
      const docMatches = content.match(/https:\/\/docs\.google\.com\/document\/d\/[a-zA-Z0-9_-]+\/edit/g);
      if (docMatches) docMatches.forEach(url => stickyItems.push(`Google Doc: ${url}`));
      const sheetMatches = content.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+\/edit/g);
      if (sheetMatches) sheetMatches.forEach(url => stickyItems.push(`Google Sheet: ${url}`));
      const lumaMatches = content.match(/https:\/\/lu\.ma\/[a-zA-Z0-9_-]+/g);
      if (lumaMatches) lumaMatches.forEach(url => stickyItems.push(`Luma event: ${url}`));
    }

    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
      while (history.length > 0 && history[0].role !== "user") {
        history.shift();
      }
    }

    // Summarize older messages to save context window
    if (history.length > KEEP_RECENT) {
      const oldMessages = history.slice(0, -KEEP_RECENT);
      const recentMessages = history.slice(-KEEP_RECENT);

      const summaryParts: string[] = [];
      for (const msg of oldMessages) {
        if (msg.role === "user") {
          const preview = msg.content.slice(0, 80).replace(/\n/g, " ").trim();
          summaryParts.push(`User: ${preview}${msg.content.length > 80 ? "..." : ""}`);
        } else {
          const urlMatch = msg.content.match(/https?:\/\/[^\s)]+/);
          const actionMatch = msg.content.match(/I('ve|'ve| have) (sent|created|drafted|posted|saved|searched|found|scheduled|updated|deleted)[^.]*\./i);
          if (actionMatch) {
            summaryParts.push(`Assistant: ${actionMatch[0]}`);
          } else if (urlMatch) {
            summaryParts.push(`Assistant: [shared ${urlMatch[0]}]`);
          } else {
            const preview = msg.content.slice(0, 60).replace(/\n/g, " ").trim();
            summaryParts.push(`Assistant: ${preview}...`);
          }
        }
      }

      const summary = summaryParts.join("\n").slice(0, 600);
      history = [
        { role: "user" as const, content: `[Earlier in this conversation:\n${summary}\n]`, created_at: oldMessages[0].created_at },
        ...recentMessages,
      ];
      while (history.length > 0 && history[0].role !== "user") {
        history.shift();
      }
    }

    // Inject sticky context into system prompt so the AI always has it
    if (stickyItems.length > 0) {
      const stickyContext = `\n\n[SESSION CONTEXT — Documents and artifacts created in this conversation]\n${[...new Set(stickyItems)].join("\n")}\n[End of session context]`;
      extraContext = extraContext ? extraContext + stickyContext : stickyContext;
    }

    // If images were uploaded, note their presence
    if (imageAttachments?.length) {
      const imgNote = `\n\n[UPLOADED IMAGES — ${imageAttachments.length} image(s) attached to this message: ${imageAttachments.map(i => i.name).join(", ")}. You can see them via Claude vision and upload them to Google Drive (drive_upload_image) or Mailchimp (mailchimp_upload_image).]`;
      extraContext = extraContext ? extraContext + imgNote : imgNote;
    }

    // Channel routing: detect ambiguous action requests and ask user to clarify.
    // Rules-based — if multiple integrations can handle the same action, don't let AI guess.
    const rawInput = (task.input.raw_input || "").toLowerCase();
    const clarification = detectRoutingAmbiguity(rawInput);
    if (clarification) {
      addMessage(conversationId, "assistant", clarification);
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      updateTaskStatus(taskId, "completed", {
        output: JSON.stringify({ ...task.output, result: clarification }),
        execution: JSON.stringify({ model, provider, started_at: startedAt, completed_at: completedAt, duration_ms: durationMs, tool_calls_count: 0 }),
      });
      return getTaskById(taskId)!;
    }

    // Tool call logging callback
    let toolCallsCount = 0;
    const onToolCallLog: ToolCallCallback = (toolName, input, output, durationMs) => {
      toolCallsCount++;
      appendExecutionLog(taskId, {
        tool: toolName,
        input: input as Record<string, unknown>,
        output,
        duration_ms: durationMs,
      });

      // Log tool calls to activity log (errors only to keep volume manageable)
      const isError = typeof output === "string" && output.includes('"error"');
      if (isError) {
        logActivity({
          type: "tool",
          level: "error",
          source: task.input.source_channel || "unknown",
          summary: `Tool ${toolName} failed (${durationMs}ms)`,
          detail: typeof output === "string" ? output.slice(0, 500) : undefined,
          task_id: taskId,
        });
      }
    };

    // Build source context (Slack thread delivery + source channel for security restrictions)
    // For email tasks: check if sender is the user's own email (full tools) or external (restricted)
    let isOwnEmail = false;
    if (task.input.source_channel === "email") {
      const senderRaw = (task.input.metadata?.latestSender as string || "").toLowerCase();
      const senderEmail = senderRaw.match(/<([^>]+)>/)?.[1] || senderRaw.trim();
      const userEmail = getSetting("user_email")?.toLowerCase();
      const accountId = (task.input.metadata?.accountId as string || "").toLowerCase();
      isOwnEmail = !!(
        (userEmail && senderEmail === userEmail) ||
        (accountId && senderEmail === accountId)
      );
    }

    const sourceContext: SourceContext = {
      sourceChannel: task.input.source_channel,
      isOwnEmail,
      ...(task.input.source_channel === "slack" && task.input.metadata?.channelId
        ? { channelId: task.input.metadata.channelId as string, threadTs: task.input.metadata.threadTs as string | undefined }
        : {}),
      ...(imageAttachments?.length ? { imageAttachments } : {}),
    };

    // Inject image attachments into the last user message for Claude vision
    if (imageAttachments?.length && history.length > 0) {
      const lastIdx = history.length - 1;
      if (history[lastIdx].role === "user") {
        const imageBlocks = imageAttachments.map(img => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: img.mimeType, data: img.content },
        }));
        // Replace text content with multipart content (text + images)
        (history[lastIdx] as any).multipartContent = [
          { type: "text", text: history[lastIdx].content },
          ...imageBlocks,
        ];
      }
    }

    // Call the appropriate provider
    const caller = provider === "anthropic" ? callAnthropic : callOpenAI;
    let response = await caller(
      model,
      apiKey,
      systemPrompt,
      history,
      temperature,
      maxTokens,
      onStatus,
      onToolCallLog,
      sourceContext
    );

    // Hallucination guard: if the AI made zero tool calls but claims it performed an action,
    // that's a hallucination. Rules-based — check the OUTPUT for success claims, not the input
    // for action keywords. Legitimate 0-tool responses (follow-up questions, conversation) pass through.
    const claimsAction = /\b(I've sent|I've drafted|I've created|I've written|I've saved|I've uploaded|I've updated|I've deleted|I've added|I've removed|I've scheduled|I've posted|I've modified|I've edited|I've confirmed|I've prepared|successfully sent|successfully created|successfully saved|successfully drafted|successfully posted|successfully updated|Email Sent|Event Created|Draft Created|File Saved|Document Created|here's the document|here's the Google Doc)\b/i;
    let hallucinationCaught = false;
    if (toolCallsCount === 0 && claimsAction.test(response.content || "")) {
      console.log(`[processor] Hallucination guard: task ${taskId} claims action with 0 tool calls — retrying with clean context`);
      toolCallsCount = 0;
      const cleanHistory = [{ role: "user" as const, content: task.input.raw_input, created_at: new Date().toISOString() }];
      response = await caller(
        model,
        apiKey,
        systemPrompt,
        cleanHistory,
        temperature,
        maxTokens,
        onStatus,
        onToolCallLog,
        sourceContext
      );

      // If retry still claims action with 0 tool calls, hard reject
      if (toolCallsCount === 0 && claimsAction.test(response.content || "")) {
        console.log(`[processor] Hallucination guard: task ${taskId} retry still hallucinating — rejecting`);
        response = { role: "assistant", content: "I wasn't able to complete that action. Please try again — if the issue persists, try rephrasing your request." };
        hallucinationCaught = true;
      }
    }

    // Save assistant response to conversation — but NOT rejected hallucinations,
    // which would contaminate future requests in the same conversation
    if (!hallucinationCaught && response.content && response.content.trim()) {
      addMessage(conversationId, "assistant", response.content);
    }

    // Mark completed
    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    updateTaskStatus(taskId, "completed", {
      output: JSON.stringify({
        ...task.output,
        result: response.content || "",
      }),
      execution: JSON.stringify({
        model,
        provider,
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: durationMs,
        tool_calls_count: toolCallsCount,
      }),
    });

    // Track in Agnost (fire and forget)
    const execLog = require("./task").getTaskExecutionLog(taskId);
    trackTask({
      taskId,
      sessionId: task.input.metadata?.sessionId as string || taskId,
      source: task.input.source_channel || "unknown",
      agentName: getSetting("agent_name") || undefined,
      userInput: task.input.raw_input || "",
      aiOutput: response.content || "",
      success: !hallucinationCaught,
      durationMs,
      model,
      toolCalls: execLog.map((e: any) => ({
        tool: e.tool,
        input: e.input,
        output: e.output?.slice(0, 500),
        durationMs: e.duration_ms,
        success: !e.output?.includes('"error"'),
      })),
    }).catch(() => {});

    return getTaskById(taskId)!;
  } catch (err: any) {
    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    updateTaskStatus(taskId, "failed", {
      output: JSON.stringify({
        ...task.output,
        error: err.message || "Unknown error",
      }),
      execution: JSON.stringify({
        ...task.execution,
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: durationMs,
      }),
    });
    console.error(`Task ${taskId} failed:`, err.message);
    logActivity({
      type: "error",
      level: "error",
      source: task.input.source_channel || "unknown",
      summary: `Task failed: ${err.message || "Unknown error"}`,
      detail: err.stack || err.message,
      task_id: taskId,
    });
    return getTaskById(taskId)!;
  }
}
