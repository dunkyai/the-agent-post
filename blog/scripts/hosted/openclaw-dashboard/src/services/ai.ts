import {
  getSetting, getIntegration, getOrCreateConversation, addMessage, getMessages,
  getConversationsByType, createScheduledJob, getAllScheduledJobs, getScheduledJob,
  deleteScheduledJob, addMemory, getAllMemories, deleteMemory, getMemory,
} from "./db";
import { decrypt } from "./encryption";
import { getNextRun, isValidCron, describeCron } from "./cron";
import {
  isGoogleRunning, getConnectedServices,
  gmailSearch, gmailReadMessage, gmailSend, gmailCreateDraft, gmailAddLabel,
  calendarListEvents, calendarCreateEvent, calendarUpdateEvent, calendarDeleteEvent,
  driveSearch, driveReadFile, driveCreateFile,
  contactsSearch, contactsCreate,
} from "./google";

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

// --- Code Execution Tools ---

const CODE_EXECUTION_TOOLS = [
  {
    name: "run_command",
    description: "Execute a shell command in a sandboxed environment. Use this to run code, install packages, process data, or perform computations. The sandbox has Node.js 22, Python 3, bash, curl, jq, and git available. Network access is disabled. Files persist in /workspace across calls within the same conversation.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "The shell command to execute" },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a file from the sandbox workspace.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path relative to /workspace" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file in the sandbox workspace.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path relative to /workspace" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
  },
];

async function executeCodeTool(toolName: string, input: any): Promise<string> {
  const provisioningUrl = process.env.PROVISIONING_URL;
  const instanceId = process.env.INSTANCE_ID;
  const gatewayToken = process.env.GATEWAY_TOKEN;

  if (!provisioningUrl || !instanceId || !gatewayToken) {
    return JSON.stringify({ error: "Code execution not configured on this instance" });
  }

  try {
    let body: any;

    switch (toolName) {
      case "run_command":
        body = { command: input.command };
        break;
      case "read_file":
        body = { action: "read_file", path: input.path };
        break;
      case "write_file":
        body = { action: "write_file", path: input.path, content: input.content };
        break;
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }

    const res = await fetch(`${provisioningUrl}/instances/${instanceId}/sandbox/exec`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}));
      return JSON.stringify({ error: data.error || `Sandbox error (${res.status})` });
    }

    return JSON.stringify(await res.json());
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Sandbox execution failed" });
  }
}

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

// --- Google Tools ---

const GOOGLE_GMAIL_TOOLS = [
  {
    name: "gmail_search",
    description: "Search Gmail messages. Use Gmail search syntax: 'from:john@example.com', 'subject:invoice', 'is:unread', 'newer_than:7d'.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Gmail search query" },
        max_results: { type: "number", description: "Max results (default: 10, max: 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "gmail_read_message",
    description: "Read the full content of a Gmail message by ID. Use after gmail_search.",
    input_schema: {
      type: "object" as const,
      properties: {
        message_id: { type: "string", description: "The Gmail message ID" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "gmail_send",
    description: "Send an email from the user's Gmail.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Recipient email" },
        subject: { type: "string", description: "Subject line" },
        body: { type: "string", description: "Email body (plain text)" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_create_draft",
    description: "Create a draft email without sending it.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Recipient email" },
        subject: { type: "string", description: "Subject line" },
        body: { type: "string", description: "Email body (plain text)" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_label",
    description: "Add a label to a Gmail message.",
    input_schema: {
      type: "object" as const,
      properties: {
        message_id: { type: "string", description: "The Gmail message ID" },
        label_name: { type: "string", description: "Label name (e.g., 'IMPORTANT', 'STARRED', or custom)" },
      },
      required: ["message_id", "label_name"],
    },
  },
];

const GOOGLE_CALENDAR_TOOLS = [
  {
    name: "calendar_list_events",
    description: "List upcoming calendar events.",
    input_schema: {
      type: "object" as const,
      properties: {
        time_min: { type: "string", description: "Start of range (ISO 8601). Defaults to now." },
        time_max: { type: "string", description: "End of range (ISO 8601). Defaults to 7 days." },
        max_results: { type: "number", description: "Max events (default: 10)" },
      },
    },
  },
  {
    name: "calendar_create_event",
    description: "Create a new calendar event.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "Event title" },
        start: { type: "string", description: "Start time (ISO 8601)" },
        end: { type: "string", description: "End time (ISO 8601)" },
        description: { type: "string", description: "Event description" },
        attendees: { type: "string", description: "Comma-separated attendee emails" },
        location: { type: "string", description: "Event location" },
      },
      required: ["summary", "start", "end"],
    },
  },
  {
    name: "calendar_update_event",
    description: "Update an existing calendar event.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string", description: "Event ID" },
        summary: { type: "string", description: "New title" },
        start: { type: "string", description: "New start time" },
        end: { type: "string", description: "New end time" },
        description: { type: "string", description: "New description" },
      },
      required: ["event_id"],
    },
  },
  {
    name: "calendar_delete_event",
    description: "Delete a calendar event.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string", description: "Event ID to delete" },
      },
      required: ["event_id"],
    },
  },
];

const GOOGLE_DRIVE_TOOLS = [
  {
    name: "drive_search",
    description: "Search Google Drive files by name.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query (file name keywords)" },
        max_results: { type: "number", description: "Max files (default: 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "drive_read_file",
    description: "Read content of a Google Drive file. Supports Docs (text), Sheets (CSV), and text files.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "Google Drive file ID" },
      },
      required: ["file_id"],
    },
  },
  {
    name: "drive_create_file",
    description: "Create a new file in Google Drive.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "File name" },
        content: { type: "string", description: "File content" },
        mime_type: { type: "string", description: "MIME type. Use 'application/vnd.google-apps.document' for Docs, 'text/plain' for text." },
        folder_id: { type: "string", description: "Parent folder ID (optional)" },
      },
      required: ["name", "content"],
    },
  },
];

const GOOGLE_CONTACTS_TOOLS = [
  {
    name: "contacts_search",
    description: "Search Google Contacts by name, email, or phone.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "contacts_create",
    description: "Create a new Google Contact.",
    input_schema: {
      type: "object" as const,
      properties: {
        given_name: { type: "string", description: "First name" },
        family_name: { type: "string", description: "Last name" },
        email: { type: "string", description: "Email address" },
        phone: { type: "string", description: "Phone number" },
      },
      required: ["given_name"],
    },
  },
];

async function executeGoogleTool(toolName: string, input: any): Promise<string> {
  if (!isGoogleRunning()) {
    return JSON.stringify({ error: "Google is not connected. Ask the user to connect Google in the integrations page." });
  }

  try {
    switch (toolName) {
      case "gmail_search":
        return await gmailSearch(input.query, input.max_results);
      case "gmail_read_message":
        return await gmailReadMessage(input.message_id);
      case "gmail_send":
        return await gmailSend(input.to, input.subject, input.body);
      case "gmail_create_draft":
        return await gmailCreateDraft(input.to, input.subject, input.body);
      case "gmail_label":
        return await gmailAddLabel(input.message_id, input.label_name);
      case "calendar_list_events":
        return await calendarListEvents(input.time_min, input.time_max, input.max_results);
      case "calendar_create_event":
        return await calendarCreateEvent(input);
      case "calendar_update_event":
        return await calendarUpdateEvent(input.event_id, input);
      case "calendar_delete_event":
        return await calendarDeleteEvent(input.event_id);
      case "drive_search":
        return await driveSearch(input.query, input.max_results);
      case "drive_read_file":
        return await driveReadFile(input.file_id);
      case "drive_create_file":
        return await driveCreateFile(input.name, input.content, input.mime_type, input.folder_id);
      case "contacts_search":
        return await contactsSearch(input.query);
      case "contacts_create":
        return await contactsCreate(input);
      default:
        return JSON.stringify({ error: `Unknown Google tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Google API call failed" });
  }
}

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
    ...CODE_EXECUTION_TOOLS,
  ];

  // Conditionally add Google tools based on connected services
  const googleServices = getConnectedServices();
  if (googleServices) {
    if (googleServices.includes("gmail")) tools.push(...GOOGLE_GMAIL_TOOLS);
    if (googleServices.includes("calendar")) tools.push(...GOOGLE_CALENDAR_TOOLS);
    if (googleServices.includes("drive")) tools.push(...GOOGLE_DRIVE_TOOLS);
    if (googleServices.includes("contacts")) tools.push(...GOOGLE_CONTACTS_TOOLS);
  }

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
      const memoryTools = ["save_memory", "list_memories", "delete_memory"];
      const codeTools = ["run_command", "read_file", "write_file"];
      const googleToolNames = [
        "gmail_search", "gmail_read_message", "gmail_send", "gmail_create_draft", "gmail_label",
        "calendar_list_events", "calendar_create_event", "calendar_update_event", "calendar_delete_event",
        "drive_search", "drive_read_file", "drive_create_file",
        "contacts_search", "contacts_create",
      ];
      for (const toolBlock of customToolUseBlocks) {
        let result: string;
        if (memoryTools.includes(toolBlock.name)) {
          result = executeMemoryTool(toolBlock.name, toolBlock.input);
        } else if (codeTools.includes(toolBlock.name)) {
          result = await executeCodeTool(toolBlock.name, toolBlock.input);
        } else if (googleToolNames.includes(toolBlock.name)) {
          result = await executeGoogleTool(toolBlock.name, toolBlock.input);
        } else {
          result = executeSchedulingTool(toolBlock.name, toolBlock.input);
        }
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

  // Inject Google context
  try {
    const googleIntegration = getIntegration("google");
    if (googleIntegration && googleIntegration.status === "connected") {
      const googleCfg = JSON.parse(decrypt(googleIntegration.config));
      let googleContext = `You have access to the user's Google account (${googleCfg.google_email}).`;
      const svcs = googleCfg.services as string[];
      if (svcs.includes("gmail")) googleContext += " You can search, read, send, draft, and label Gmail messages.";
      if (svcs.includes("calendar")) googleContext += " You can view, create, update, and delete Google Calendar events.";
      if (svcs.includes("drive")) googleContext += " You can search, read, and create Google Drive files.";
      if (svcs.includes("contacts")) googleContext += " You can search and create Google Contacts.";
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${googleContext}` : googleContext;
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
