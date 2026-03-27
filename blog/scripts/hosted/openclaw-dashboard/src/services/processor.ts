import type { Task } from "../types/task";
import {
  getTaskById,
  updateTaskStatus,
  appendExecutionLog,
} from "./task";
import {
  buildSystemPrompt,
  getProvider,
  getApiKey,
  callAnthropic,
  callOpenAI,
  type ToolCallCallback,
} from "./ai";
import { isGoogleRunning, getConnectedServices } from "./google";
import { isLumaRunning } from "./luma";
import {
  getSetting,
  getOrCreateConversation,
  addMessage,
  getMessages,
  getMonthlyTaskCount,
} from "./db";

export type StatusCallback = (status: string) => void;

/**
 * Detect when a user's request could be routed to multiple integrations.
 * Returns a clarification message if ambiguous, null if routing is clear.
 */
function detectRoutingAmbiguity(input: string): string | null {
  // Calendar: both Google Calendar and Luma connected
  const eventPattern = /\b(event|meeting|appointment|invite|calendar)\b/i;
  if (eventPattern.test(input)) {
    const googleServices = getConnectedServices();
    const hasGoogleCalendar = googleServices?.includes("calendar") ?? false;
    const hasLuma = isLumaRunning();

    if (hasGoogleCalendar && hasLuma) {
      // If user explicitly mentions which one, no ambiguity
      if (/\b(google|gcal|google calendar)\b/i.test(input)) return null;
      if (/\bluma\b/i.test(input)) return null;

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
    const model = getSetting("model") || "claude-sonnet-4-20250514";
    const temperature = parseFloat(getSetting("temperature") || "0.7");
    const maxTokens = parseInt(getSetting("max_tokens") || "4096", 10);

    // Build system prompt with any channel-specific context from metadata
    const extraContext = task.input.metadata?.context as string | undefined;
    const systemPrompt = buildSystemPrompt(extraContext);

    const provider = getProvider(model);
    const apiKey = getApiKey(provider);

    // Check monthly usage limit
    const messageLimit = parseInt(process.env.MESSAGE_LIMIT || "250", 10);
    const usedThisMonth = getMonthlyTaskCount();
    if (usedThisMonth >= messageLimit) {
      throw new Error("MESSAGE_LIMIT_REACHED");
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

    // Get conversation history
    const MAX_HISTORY = 20;
    let history = getMessages(conversationId).filter(
      (m) => m.content && m.content.trim()
    );
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
      while (history.length > 0 && history[0].role !== "user") {
        history.shift();
      }
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
    };

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
      onToolCallLog
    );

    // Hallucination guard: if the AI made zero tool calls but claims it performed an action,
    // that's a hallucination. Rules-based — check the OUTPUT for success claims, not the input
    // for action keywords. Legitimate 0-tool responses (follow-up questions, conversation) pass through.
    const claimsAction = /\b(I've sent|I've drafted|I've created|I've searched|I've saved|I've uploaded|I've updated|I've deleted|I've added|I've removed|I've scheduled|I've posted|I've modified|I've edited|I've found|I've checked|I've confirmed|successfully sent|successfully created|successfully saved|successfully drafted|successfully posted|successfully updated|Email Sent|Event Created|Draft Created|File Saved)\b/i;
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
        onToolCallLog
      );

      // If retry still claims action with 0 tool calls, hard reject
      if (toolCallsCount === 0 && claimsAction.test(response.content || "")) {
        console.log(`[processor] Hallucination guard: task ${taskId} retry still hallucinating — rejecting`);
        response = { role: "assistant", content: "I wasn't able to complete that action. Please try again — if the issue persists, try rephrasing your request." };
      }
    }

    // Save assistant response to conversation
    if (response.content && response.content.trim()) {
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
    return getTaskById(taskId)!;
  }
}
