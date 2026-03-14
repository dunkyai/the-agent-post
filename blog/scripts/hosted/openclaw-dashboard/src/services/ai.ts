import {
  getSetting, getIntegration, getOrCreateConversation, addMessage, getMessages,
  getConversationsByType, createScheduledJob, getAllScheduledJobs, getScheduledJob,
  deleteScheduledJob, addMemory, getAllMemories, deleteMemory, getMemory,
} from "./db";
import { decrypt } from "./encryption";
import { getNextRun, isValidCron, describeCron } from "./cron";

interface AIResponse {
  role: string;
  content: string;
}

function getProvider(model: string): "anthropic" | "openai" {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) return "openai";
  return "openai"; // default fallback
}

function getApiKey(provider: "anthropic" | "openai"): string {
  const key = provider === "anthropic" ? "anthropic_api_key" : "openai_api_key";
  const encrypted = getSetting(key);
  if (!encrypted) {
    throw new Error(`No ${provider} API key configured. Go to Settings to add one.`);
  }
  return decrypt(encrypted);
}

// --- Scheduling Tools ---

const SCHEDULING_TOOLS = [
  {
    name: "create_scheduled_job",
    description: "Create a new scheduled job that runs on a cron schedule. Use this when the user asks to be reminded of something, schedule a recurring task, or set up periodic actions.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "A short descriptive name for the job" },
        schedule: { type: "string", description: "A 5-field cron expression. Examples: '0 9 * * 1' (Monday 9am), '*/30 * * * *' (every 30 min), '0 0 * * *' (daily midnight). Fields: minute hour day-of-month month day-of-week." },
        prompt: { type: "string", description: "The prompt/instruction sent to the AI when the job fires" },
      },
      required: ["name", "schedule", "prompt"],
    },
  },
  {
    name: "list_scheduled_jobs",
    description: "List all currently scheduled jobs. Use when the user asks what's scheduled or what reminders are set.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "delete_scheduled_job",
    description: "Delete a scheduled job by its ID. Use when the user asks to cancel a reminder or remove a scheduled task.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: { type: "number", description: "The ID of the job to delete" },
      },
      required: ["job_id"],
    },
  },
];

const MEMORY_TOOLS = [
  {
    name: "save_memory",
    description: "Save an important fact, preference, or piece of information to long-term memory. Use this proactively when the user shares something worth remembering (preferences, facts about themselves, decisions, important context). Also use when they explicitly say 'remember this'.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "The fact or information to remember. Be concise but specific." },
      },
      required: ["content"],
    },
  },
  {
    name: "list_memories",
    description: "List all saved memories. Use when the user asks what you remember about them.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "delete_memory",
    description: "Delete a memory by its ID. Use when the user asks to forget something or when information is outdated.",
    input_schema: {
      type: "object" as const,
      properties: {
        memory_id: { type: "number", description: "The ID of the memory to delete" },
      },
      required: ["memory_id"],
    },
  },
];

function executeMemoryTool(toolName: string, input: any): string {
  switch (toolName) {
    case "save_memory": {
      const id = addMemory(input.content);
      return JSON.stringify({ success: true, memory_id: id, content: input.content });
    }
    case "list_memories": {
      const memories = getAllMemories();
      return JSON.stringify({
        memories: memories.map((m) => ({ id: m.id, content: m.content, created_at: m.created_at })),
      });
    }
    case "delete_memory": {
      const mem = getMemory(input.memory_id);
      if (!mem) return JSON.stringify({ error: `Memory #${input.memory_id} not found.` });
      deleteMemory(input.memory_id);
      return JSON.stringify({ success: true, deleted: mem.content });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

function executeSchedulingTool(toolName: string, input: any): string {
  switch (toolName) {
    case "create_scheduled_job": {
      if (!isValidCron(input.schedule)) {
        return JSON.stringify({ error: `Invalid cron expression: "${input.schedule}"` });
      }
      const nextRun = getNextRun(input.schedule);
      const id = createScheduledJob({
        name: input.name,
        schedule: input.schedule,
        prompt: input.prompt,
        created_by: "ai",
        next_run: nextRun.toISOString(),
      });
      return JSON.stringify({
        success: true,
        job_id: id,
        name: input.name,
        schedule_description: describeCron(input.schedule),
        next_run: nextRun.toISOString(),
      });
    }
    case "list_scheduled_jobs": {
      const jobs = getAllScheduledJobs();
      return JSON.stringify({
        jobs: jobs.map((j) => ({
          id: j.id,
          name: j.name,
          schedule: j.schedule,
          schedule_description: describeCron(j.schedule),
          prompt: j.prompt.slice(0, 100),
          enabled: !!j.enabled,
          created_by: j.created_by,
          next_run: j.next_run,
        })),
      });
    }
    case "delete_scheduled_job": {
      const job = getScheduledJob(input.job_id);
      if (!job) return JSON.stringify({ error: `Job #${input.job_id} not found.` });
      deleteScheduledJob(input.job_id);
      return JSON.stringify({ success: true, deleted_job: job.name });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// --- Anthropic API with tool use loop ---

async function callAnthropic(
  model: string,
  apiKey: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  temperature: number,
  maxTokens: number
): Promise<AIResponse> {
  const tools: any[] = [
    { type: "web_search_20250305", name: "web_search" },
    ...SCHEDULING_TOOLS,
    ...MEMORY_TOOLS,
  ];

  const apiMessages: any[] = messages.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));

  const MAX_TOOL_ROUNDS = 5;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt || undefined,
        messages: apiMessages,
        temperature,
        tools,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${body}`);
    }

    const data: any = await res.json();

    // Find our custom tool_use blocks (not web_search which is server-side)
    const customToolUseBlocks = (data.content || []).filter(
      (b: any) => b.type === "tool_use" && b.name !== "web_search"
    );

    if (data.stop_reason === "tool_use" && customToolUseBlocks.length > 0) {
      // Append assistant response with tool_use blocks
      apiMessages.push({ role: "assistant", content: data.content });

      // Execute each tool and build results
      const toolResults: any[] = [];
      for (const toolBlock of customToolUseBlocks) {
        const isMemoryTool = ["save_memory", "list_memories", "delete_memory"].includes(toolBlock.name);
        const result = isMemoryTool
          ? executeMemoryTool(toolBlock.name, toolBlock.input)
          : executeSchedulingTool(toolBlock.name, toolBlock.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: result,
        });
      }

      apiMessages.push({ role: "user", content: toolResults });
      continue;
    }

    // No more custom tool calls — extract final text
    const textBlocks = (data.content || []).filter((b: any) => b.type === "text");
    const text = textBlocks.map((b: any) => b.text).join("\n\n") || "";
    return { role: "assistant", content: text };
  }

  return { role: "assistant", content: "I hit the tool use limit. Please try again." };
}

async function callOpenAI(
  model: string,
  apiKey: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  temperature: number,
  maxTokens: number
): Promise<AIResponse> {
  const allMessages: { role: string; content: string }[] = [];

  if (systemPrompt) {
    allMessages.push({ role: "system", content: systemPrompt });
  }

  allMessages.push(
    ...messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }))
  );

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: allMessages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${body}`);
  }

  const data: any = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return { role: "assistant", content: text };
}

export async function processMessage(
  source: string,
  externalId: string,
  text: string,
  context?: string
): Promise<string> {
  const model = getSetting("model") || "claude-sonnet-4-20250514";
  let systemPrompt = getSetting("system_prompt") || "";
  const temperature = parseFloat(getSetting("temperature") || "0.7");
  const maxTokens = parseInt(getSetting("max_tokens") || "1024", 10);

  // Inject agent name
  const agentName = getSetting("agent_name");
  if (agentName) {
    const nameContext = `Your name is ${agentName}. Always refer to yourself as ${agentName}, never as Claude or any other name.`;
    systemPrompt = nameContext + (systemPrompt ? `\n\n${systemPrompt}` : "");
  }

  if (context) {
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${context}` : context;
  }

  // Inject connected email address and recent email conversations
  try {
    const emailIntegration = getIntegration("email");
    if (emailIntegration && emailIntegration.status === "connected") {
      const emailConfig = JSON.parse(decrypt(emailIntegration.config));
      if (emailConfig.email_address) {
        let emailContext = `Your email address is ${emailConfig.email_address}. People can reach you by emailing this address.`;

        const emailConversations = getConversationsByType("email");
        if (emailConversations.length > 0) {
          const summaries: string[] = [];
          for (const conv of emailConversations.slice(0, 5)) {
            const msgs = getMessages(conv.id, 10);
            if (msgs.length === 0) continue;
            const lines = msgs.map((m) => `  ${m.role === "user" ? conv.external_id : "You"}: ${m.content.slice(0, 200)}`);
            summaries.push(`Email thread with ${conv.external_id}:\n${lines.join("\n")}`);
          }
          if (summaries.length > 0) {
            emailContext += `\n\nRecent email conversations:\n${summaries.join("\n\n")}`;
          }
        }

        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${emailContext}` : emailContext;
      }
    }
  } catch {}

  // Inject long-term memories
  try {
    const memories = getAllMemories();
    if (memories.length > 0) {
      const memoryList = memories.map((m) => `- ${m.content}`).join("\n");
      const memContext = `Your long-term memories (things you've been asked to remember or proactively saved):\n${memoryList}\n\nUse the save_memory tool to remember new important facts. Use delete_memory to remove outdated ones.`;
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${memContext}` : memContext;
    } else {
      const memContext = "You have a long-term memory system. Use the save_memory tool to remember important facts, user preferences, and key information across conversations. Be proactive about saving things worth remembering.";
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${memContext}` : memContext;
    }
  } catch {}

  // Inject scheduling context
  try {
    const allJobs = getAllScheduledJobs();
    if (allJobs.length > 0) {
      const jobSummaries = allJobs.map(
        (j) => `- #${j.id} "${j.name}" (${describeCron(j.schedule)}) ${j.enabled ? "enabled" : "disabled"}`
      ).join("\n");
      const schedContext = `You can create, list, and delete scheduled jobs. Current jobs:\n${jobSummaries}`;
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${schedContext}` : schedContext;
    } else {
      const schedContext = "You can create, list, and delete scheduled jobs using the scheduling tools. No jobs are currently scheduled.";
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${schedContext}` : schedContext;
    }
  } catch {}

  const provider = getProvider(model);
  const apiKey = getApiKey(provider);

  const conversationId = getOrCreateConversation(source, externalId);
  addMessage(conversationId, "user", text);

  const history = getMessages(conversationId);

  const caller = provider === "anthropic" ? callAnthropic : callOpenAI;
  const response = await caller(model, apiKey, systemPrompt, history, temperature, maxTokens);

  addMessage(conversationId, "assistant", response.content);

  return response.content;
}
