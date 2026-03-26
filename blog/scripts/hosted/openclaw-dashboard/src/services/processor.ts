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
import {
  getSetting,
  getOrCreateConversation,
  addMessage,
  getMessages,
  getMonthlyTaskCount,
} from "./db";

export type StatusCallback = (status: string) => void;

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
    const response = await caller(
      model,
      apiKey,
      systemPrompt,
      history,
      temperature,
      maxTokens,
      onStatus,
      onToolCallLog
    );

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
