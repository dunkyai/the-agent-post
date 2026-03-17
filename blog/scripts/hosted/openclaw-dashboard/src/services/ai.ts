import {
  getSetting, getIntegration, getOrCreateConversation, addMessage, getMessages,
  getConversationsByType, createScheduledJob, getAllScheduledJobs, getScheduledJob,
  deleteScheduledJob, addMemory, getAllMemories, deleteMemory, getMemory,
} from "./db";
import { decrypt } from "./encryption";
import { getNextRun, isValidCron, describeCron } from "./cron";
import {
  isGoogleRunning, getConnectedServices, getGoogleAccounts,
  gmailSearch, gmailReadMessage, gmailSend, gmailCreateDraft, gmailAddLabel, gmailGetSendAsAliases,
  calendarListEvents, calendarCreateEvent, calendarUpdateEvent,
  driveSearch, driveReadFile, extractDriveFileId,
  contactsSearch,
} from "./google";
import { sendTelegramMessage, isTelegramRunning } from "./telegram";
import { sendSlackMessage, isSlackRunning, getChannelMembers } from "./slack";
import { sendEmailMessage, isEmailRunning, checkInbox } from "./email";
import {
  isSupabaseRunning, getSupabaseProjectUrl, getSupabasePermissions,
  supabaseListTables, supabaseDescribeTable, supabaseQuery, supabaseInsert, supabaseUpdate,
} from "./supabase";
import {
  isAirtableRunning,
  airtableListBases, airtableListTables, airtableListRecords, airtableCreateRecords, airtableUpdateRecords,
} from "./airtable";

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

// --- Browser Automation Tools ---

const BROWSER_TOOLS = [
  {
    name: "browse_webpage",
    description: "Navigate to a URL and get the page content. Use this to visit websites, read articles, check information, or start interacting with a web page. Returns the page title, URL, and text content.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The URL to navigate to (must be http or https)" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_click",
    description: "Click an element on the current page. Use a CSS selector (e.g., '#submit-btn', 'button[type=\"submit\"]') or text content (e.g., 'Sign In', 'Next'). Use browser_screenshot first to see available elements.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: { type: "string", description: "CSS selector or visible text of the element to click" },
      },
      required: ["selector"],
    },
  },
  {
    name: "browser_type",
    description: "Type text into an input field on the current page. Use a CSS selector (e.g., '#email', 'input[name=\"username\"]') or the field's placeholder/label text. Use browser_screenshot first to see available fields.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: { type: "string", description: "CSS selector, placeholder text, or label text of the input field" },
        text: { type: "string", description: "The text to type into the field" },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "browser_screenshot",
    description: "Get a description of the current page including the title, URL, and all visible interactive elements (links, buttons, inputs, etc.) with their selectors. Use this to understand what's on the page before clicking or typing.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "browser_get_content",
    description: "Get the full text content of the current page. Use this after navigating or clicking to read the updated page content.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
];

async function executeBrowserTool(toolName: string, input: any): Promise<string> {
  const provisioningUrl = process.env.PROVISIONING_URL;
  const instanceId = process.env.INSTANCE_ID;
  const gatewayToken = process.env.GATEWAY_TOKEN;

  if (!provisioningUrl || !instanceId || !gatewayToken) {
    return JSON.stringify({ error: "Browser automation not configured on this instance" });
  }

  try {
    const actionMap: Record<string, string> = {
      browse_webpage: "navigate",
      browser_click: "click",
      browser_type: "type",
      browser_screenshot: "screenshot",
      browser_get_content: "get_content",
    };

    const action = actionMap[toolName];
    if (!action) {
      return JSON.stringify({ error: `Unknown browser tool: ${toolName}` });
    }

    const body: any = {};
    if (toolName === "browse_webpage") body.url = input.url;
    if (toolName === "browser_click") body.selector = input.selector;
    if (toolName === "browser_type") {
      body.selector = input.selector;
      body.text = input.text;
    }

    const res = await fetch(`${provisioningUrl}/instances/${instanceId}/browser/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}));
      const error = data.error || `Browser action failed (${res.status})`;
      // Detect bot-blocked or timeout errors on navigate
      if (toolName === "browse_webpage" && (error.includes("Timeout") || error.includes("ERR_HTTP2") || error.includes("ERR_CONNECTION") || error.includes("net::ERR_"))) {
        return JSON.stringify({
          error: `Could not access this website. The site likely blocks automated browsers (bot detection). This is common with major commercial sites like hotels, airlines, and banks. Try searching for the information using web_search instead, or try a different website that provides similar content.`,
          original_error: error,
        });
      }
      return JSON.stringify({ error });
    }

    return JSON.stringify(await res.json());
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Browser action failed" });
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

// --- Messaging Tools (cross-channel) ---

const TELEGRAM_MESSAGING_TOOLS = [
  {
    name: "send_telegram",
    description: "Send a message to a Telegram chat. Use when the user asks you to message someone on Telegram, or when you need to proactively reach out via Telegram.",
    input_schema: {
      type: "object" as const,
      properties: {
        chat_id: { type: "string", description: "The Telegram chat ID to send to" },
        message: { type: "string", description: "The message text to send" },
      },
      required: ["chat_id", "message"],
    },
  },
];

const SLACK_MESSAGING_TOOLS = [
  {
    name: "send_slack",
    description: "Send a message to a Slack channel. Use when the user asks you to message someone on Slack, or when you need to proactively reach out via Slack.",
    input_schema: {
      type: "object" as const,
      properties: {
        channel: { type: "string", description: "The Slack channel ID to send to" },
        message: { type: "string", description: "The message text to send" },
      },
      required: ["channel", "message"],
    },
  },
  {
    name: "slack_channel_members",
    description: "List the members of a Slack channel. Use when you need to see who is in a channel, find someone's name or user ID, or understand the audience.",
    input_schema: {
      type: "object" as const,
      properties: {
        channel: { type: "string", description: "The Slack channel ID" },
      },
      required: ["channel"],
    },
  },
];

const EMAIL_MESSAGING_TOOLS = [
  {
    name: "check_lobstermail",
    description: "Check your LobsterMail inbox for recent emails. Use when the user asks you to check email, see if anyone emailed, or review your inbox.",
    input_schema: {
      type: "object" as const,
      properties: {
        max_results: { type: "number", description: "Max emails to return (default: 10)" },
      },
    },
  },
  {
    name: "send_lobstermail",
    description: "Send an email from your LobsterMail address. Only works with a Tier 1+ LobsterMail API key. If this fails, suggest using gmail_send or gmail_create_draft instead (requires Google integration).",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body (plain text)" },
      },
      required: ["to", "subject", "body"],
    },
  },
];

async function executeMessagingTool(toolName: string, input: any): Promise<string> {
  try {
    switch (toolName) {
      case "send_telegram":
        await sendTelegramMessage(input.chat_id, input.message);
        return JSON.stringify({ success: true, channel: "telegram", chat_id: input.chat_id });
      case "send_slack":
        await sendSlackMessage(input.channel, input.message);
        return JSON.stringify({ success: true, channel: "slack", channel_id: input.channel });
      case "slack_channel_members":
        return await getChannelMembers(input.channel);
      case "check_lobstermail":
        return await checkInbox(input.max_results);
      case "send_lobstermail":
        await sendEmailMessage(input.to, input.subject, input.body);
        return JSON.stringify({ success: true, channel: "email", to: input.to });
      default:
        return JSON.stringify({ error: `Unknown messaging tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to send message" });
  }
}

// --- Supabase Tools ---

const SUPABASE_READ_TOOLS = [
  {
    name: "supabase_list_tables",
    description: "List all tables in the connected Supabase database.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "supabase_describe_table",
    description: "Describe a Supabase table's columns by fetching a sample row. ALWAYS call this before querying a table you haven't seen yet, so you know the correct column names and types.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: "Table name" },
      },
      required: ["table"],
    },
  },
  {
    name: "supabase_query",
    description: "Query records from a Supabase table. You MUST specify a 'select' with only the columns you need — never omit it. Call supabase_describe_table first to learn column names and types. PostgREST filter syntax: {\"name\": \"eq.John\"}, {\"name\": \"ilike.*john*\"}, {\"age\": \"gte.18\"}. For array columns: {\"tags\": \"cs.{value}\"} (contains), {\"tags\": \"ov.{a,b}\"} (overlaps/any of). NEVER use eq/ilike on array columns. If a query times out, the tool will automatically retry without filters — you should then filter the returned results yourself.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: "Table name" },
        select: { type: "string", description: "REQUIRED. Columns to return (comma-separated), e.g. 'id,name,email'. Only request columns you need." },
        filters: {
          type: "object",
          description: "PostgREST filters as key-value pairs. Keys are column names, values use operators like eq.value, neq.value, gt.value, gte.value, lt.value, lte.value, like.pattern, ilike.pattern, in.(a,b,c), is.null, is.true. For array columns use cs.{value} or ov.{a,b}.",
          additionalProperties: { type: "string" },
        },
        limit: { type: "number", description: "Max records to return (default: 50, max: 200)" },
      },
      required: ["table", "select"],
    },
  },
];

const SUPABASE_INSERT_TOOLS = [
  {
    name: "supabase_insert",
    description: "Insert one or more records into a Supabase table.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: "Table name" },
        records: {
          type: "array",
          description: "Array of objects to insert. Each object's keys are column names.",
          items: { type: "object" },
        },
      },
      required: ["table", "records"],
    },
  },
];

const SUPABASE_UPDATE_TOOLS = [
  {
    name: "supabase_update",
    description: "Update records in a Supabase table matching the given filters.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: "Table name" },
        match: {
          type: "object",
          description: "PostgREST filters to match records to update, e.g. {\"id\": \"eq.5\"}",
          additionalProperties: { type: "string" },
        },
        data: {
          type: "object",
          description: "Fields to update with their new values",
        },
      },
      required: ["table", "match", "data"],
    },
  },
];

async function executeSupabaseTool(toolName: string, input: any): Promise<string> {
  try {
    switch (toolName) {
      case "supabase_list_tables":
        return await supabaseListTables();
      case "supabase_describe_table":
        return await supabaseDescribeTable(input.table);
      case "supabase_query":
        return await supabaseQuery(input.table, input.select, input.filters, input.limit);
      case "supabase_insert":
        return await supabaseInsert(input.table, input.records);
      case "supabase_update":
        return await supabaseUpdate(input.table, input.match, input.data);
      default:
        return JSON.stringify({ error: `Unknown Supabase tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Supabase operation failed" });
  }
}

// --- Airtable Tools ---

const AIRTABLE_TOOLS = [
  {
    name: "airtable_list_bases",
    description: "List all Airtable bases (workspaces) you have access to.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "airtable_list_tables",
    description: "List all tables and their fields in a specific Airtable base.",
    input_schema: {
      type: "object" as const,
      properties: {
        base_id: { type: "string", description: "The Airtable base ID (starts with 'app')" },
      },
      required: ["base_id"],
    },
  },
  {
    name: "airtable_list_records",
    description: "List records from an Airtable table. Supports filtering, sorting, and pagination.",
    input_schema: {
      type: "object" as const,
      properties: {
        base_id: { type: "string", description: "The Airtable base ID" },
        table: { type: "string", description: "Table name or ID" },
        view: { type: "string", description: "View name or ID (optional)" },
        filter_by_formula: { type: "string", description: "Airtable formula to filter records, e.g. \"{Status} = 'Active'\"" },
        sort_field: { type: "string", description: "Field name to sort by" },
        sort_direction: { type: "string", description: "'asc' or 'desc'" },
        max_records: { type: "number", description: "Maximum records to return (default: 100)" },
      },
      required: ["base_id", "table"],
    },
  },
];

async function executeAirtableTool(toolName: string, input: any): Promise<string> {
  try {
    switch (toolName) {
      case "airtable_list_bases":
        return await airtableListBases();
      case "airtable_list_tables":
        return await airtableListTables(input.base_id);
      case "airtable_list_records": {
        const sort = input.sort_field ? [{ field: input.sort_field, direction: input.sort_direction }] : undefined;
        return await airtableListRecords(input.base_id, input.table, {
          view: input.view,
          filterByFormula: input.filter_by_formula,
          sort,
          maxRecords: input.max_records,
        });
      }
      default:
        return JSON.stringify({ error: `Unknown Airtable tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Airtable operation failed" });
  }
}

// --- Public Google Doc Tool (no OAuth needed) ---

const PUBLIC_GDOC_TOOLS = [
  {
    name: "open_google_doc",
    description: "Open and read a publicly shared Google Docs, Sheets, or Slides URL. Works without Google OAuth — the document must be shared as 'Anyone with the link can view'. Use this when someone pastes a Google Doc link.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The Google Docs/Sheets/Slides URL" },
      },
      required: ["url"],
    },
  },
];

async function executePublicGDocTool(input: any): Promise<string> {
  const url: string = input.url;
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    return JSON.stringify({ error: "Could not extract file ID from URL. Make sure it's a Google Docs, Sheets, or Slides link." });
  }
  const fileId = match[1];

  // Determine export format from URL
  let exportUrl: string;
  if (url.includes("docs.google.com/document")) {
    exportUrl = `https://docs.google.com/document/d/${fileId}/export?format=txt`;
  } else if (url.includes("docs.google.com/spreadsheets")) {
    exportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv`;
  } else if (url.includes("docs.google.com/presentation")) {
    exportUrl = `https://docs.google.com/presentation/d/${fileId}/export?format=txt`;
  } else {
    // Generic Drive file — try text export
    exportUrl = `https://drive.google.com/uc?id=${fileId}&export=download`;
  }

  try {
    const res = await fetch(exportUrl, { redirect: "follow" });
    if (res.status === 403 || res.status === 401) {
      return JSON.stringify({ error: "This document is not publicly shared. The owner needs to set sharing to 'Anyone with the link can view', or you can connect Google OAuth on the Integrations page to access private documents." });
    }
    if (!res.ok) {
      return JSON.stringify({ error: `Failed to fetch document (${res.status})` });
    }
    const text = await res.text();
    if (text.includes("<!DOCTYPE html>") && text.includes("ServiceLogin")) {
      return JSON.stringify({ error: "This document is not publicly shared. The owner needs to set sharing to 'Anyone with the link can view', or you can connect Google OAuth on the Integrations page to access private documents." });
    }
    return JSON.stringify({ content: text.slice(0, 50000) });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to fetch document" });
  }
}

// --- Google Tools ---

const GOOGLE_GMAIL_TOOLS = [
  {
    name: "gmail_search",
    description: "Search Gmail messages. Use Gmail search syntax: 'from:john@example.com', 'subject:invoice', 'is:unread', 'newer_than:7d'. If multiple Google accounts are connected, specify which account to search.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Gmail search query" },
        max_results: { type: "number", description: "Max results (default: 10, max: 20)" },
        account: { type: "string", description: "Google account email to use (optional, defaults to first account)" },
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
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["message_id"],
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
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["message_id", "label_name"],
    },
  },
  {
    name: "gmail_list_aliases",
    description: "List available send-as addresses (aliases) for a Gmail account. Use this to see which email addresses can be used as the 'from' address when sending or drafting.",
    input_schema: {
      type: "object" as const,
      properties: {
        account: { type: "string", description: "Google account email to use (optional)" },
      },
    },
  },
];

const GOOGLE_GMAIL_SEND_TOOLS = [
  {
    name: "gmail_create_draft",
    description: "Create a real draft email in the user's Gmail Drafts folder. The draft will appear in Gmail and can be reviewed and sent by the user. You MUST call this tool to actually create the draft — do not just write the email text in your response. If you don't know the recipient, ask the user. Use 'from' to send from an alias (use gmail_list_aliases to see available addresses).",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Full email body (plain text)" },
        account: { type: "string", description: "Google account email to use (optional)" },
        from: { type: "string", description: "Send-as alias address (optional, use gmail_list_aliases to see options)" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_send",
    description: "Send an email immediately from the user's Gmail account. The email will be sent right away — use gmail_create_draft if you want to save it as a draft instead. Use 'from' to send from an alias.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Full email body (plain text)" },
        account: { type: "string", description: "Google account email to use (optional)" },
        from: { type: "string", description: "Send-as alias address (optional, use gmail_list_aliases to see options)" },
      },
      required: ["to", "subject", "body"],
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
        account: { type: "string", description: "Google account email to use (optional)" },
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
        account: { type: "string", description: "Google account email to use (optional)" },
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
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["event_id"],
    },
  },
];

const GOOGLE_DRIVE_TOOLS = [
  {
    name: "drive_search",
    description: "Search Google Drive files by name or content. Searches Google Docs, Sheets, Slides, PDFs, and all other files. Use mime_type to filter by type.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query — matches file names and document content" },
        max_results: { type: "number", description: "Max files (default: 10)" },
        mime_type: { type: "string", description: "Filter by MIME type. Common: 'application/vnd.google-apps.document' (Google Docs), 'application/vnd.google-apps.spreadsheet' (Sheets), 'application/vnd.google-apps.presentation' (Slides)" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["query"],
    },
  },
  {
    name: "drive_read_file",
    description: "Read the full text content of a Google Drive file by its ID. Google Docs and Slides are exported as plain text, Sheets as CSV. Use after drive_search to read a specific file.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "Google Drive file ID (from drive_search results)" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["file_id"],
    },
  },
  {
    name: "drive_open_url",
    description: "Open and read a Google Docs, Sheets, Slides, or Drive URL. Use this when the user pastes a Google document link.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The Google Docs/Sheets/Slides/Drive URL" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["url"],
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
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["query"],
    },
  },
];

async function executeGoogleTool(toolName: string, input: any): Promise<string> {
  if (!isGoogleRunning()) {
    return JSON.stringify({ error: "Google is not connected. Ask the user to connect Google in the integrations page." });
  }

  const acct = input.account || undefined;

  try {
    switch (toolName) {
      case "gmail_search":
        return await gmailSearch(input.query, input.max_results, acct);
      case "gmail_read_message":
        return await gmailReadMessage(input.message_id, acct);
      case "gmail_send":
        return await gmailSend(input.to, input.subject, input.body, acct, input.from);
      case "gmail_create_draft":
        return await gmailCreateDraft(input.to, input.subject, input.body, acct, input.from);
      case "gmail_label":
        return await gmailAddLabel(input.message_id, input.label_name, acct);
      case "gmail_list_aliases":
        return await gmailGetSendAsAliases(acct);
      case "calendar_list_events":
        return await calendarListEvents(input.time_min, input.time_max, input.max_results, acct);
      case "calendar_create_event":
        return await calendarCreateEvent(input, acct);
      case "calendar_update_event":
        return await calendarUpdateEvent(input.event_id, input, acct);
      case "drive_search":
        return await driveSearch(input.query, input.max_results, input.mime_type, acct);
      case "drive_read_file":
        return await driveReadFile(input.file_id, acct);
      case "drive_open_url": {
        const fileId = extractDriveFileId(input.url);
        if (!fileId) return JSON.stringify({ error: "Could not extract file ID from URL. Make sure it's a Google Docs, Sheets, Slides, or Drive link." });
        return await driveReadFile(fileId, acct);
      }
      case "contacts_search":
        return await contactsSearch(input.query, acct);
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
    ...BROWSER_TOOLS,
  ];

  // Conditionally add messaging tools based on connected integrations
  if (isTelegramRunning()) tools.push(...TELEGRAM_MESSAGING_TOOLS);
  if (isSlackRunning()) tools.push(...SLACK_MESSAGING_TOOLS);
  if (isEmailRunning()) tools.push(...EMAIL_MESSAGING_TOOLS);
  if (isSupabaseRunning()) {
    const perms = getSupabasePermissions();
    tools.push(...SUPABASE_READ_TOOLS);
    if (perms.includes("insert")) tools.push(...SUPABASE_INSERT_TOOLS);
    if (perms.includes("update")) tools.push(...SUPABASE_UPDATE_TOOLS);
  }
  if (isAirtableRunning()) tools.push(...AIRTABLE_TOOLS);

  // Conditionally add Google tools based on connected services
  const googleServices = getConnectedServices();
  if (googleServices) {
    if (googleServices.includes("gmail")) {
      tools.push(...GOOGLE_GMAIL_TOOLS);
      if (googleServices.includes("gmail_send")) tools.push(...GOOGLE_GMAIL_SEND_TOOLS);
    }
    if (googleServices.includes("calendar")) tools.push(...GOOGLE_CALENDAR_TOOLS);
    if (googleServices.includes("drive")) tools.push(...GOOGLE_DRIVE_TOOLS);
    if (googleServices.includes("contacts")) tools.push(...GOOGLE_CONTACTS_TOOLS);
  }

  // Only add public Google Doc tool if Drive is not connected (Drive has full OAuth access)
  if (!googleServices || !googleServices.includes("drive")) {
    tools.push(...PUBLIC_GDOC_TOOLS);
  }

  const apiMessages: any[] = messages.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));

  const MAX_TOOL_ROUNDS = 25;
  const toolCallLog: string[] = []; // track tool+input fingerprints for loop detection
  const MAX_REPEAT_CALLS = 2; // allow same tool+input at most twice

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
        "gmail_search", "gmail_read_message", "gmail_send", "gmail_create_draft", "gmail_label", "gmail_list_aliases",
        "calendar_list_events", "calendar_create_event", "calendar_update_event",
        "drive_search", "drive_read_file", "drive_open_url",
        "contacts_search",
      ];
      const browserToolNames = ["browse_webpage", "browser_click", "browser_type", "browser_screenshot", "browser_get_content"];
      const messagingToolNames = ["send_telegram", "send_slack", "slack_channel_members", "send_lobstermail", "check_lobstermail"];
      const supabaseToolNames = ["supabase_list_tables", "supabase_describe_table", "supabase_query", "supabase_insert", "supabase_update"];
      const airtableToolNames = ["airtable_list_bases", "airtable_list_tables", "airtable_list_records"];
      for (const toolBlock of customToolUseBlocks) {
        console.log(`Tool call: ${toolBlock.name}`, JSON.stringify(toolBlock.input).slice(0, 200));

        // Loop detection: skip if same tool+input called too many times
        const fingerprint = `${toolBlock.name}:${JSON.stringify(toolBlock.input)}`;
        const repeatCount = toolCallLog.filter((f) => f === fingerprint).length;
        toolCallLog.push(fingerprint);
        if (repeatCount >= MAX_REPEAT_CALLS) {
          console.log(`Loop detected: ${toolBlock.name} called ${repeatCount + 1} times with same input, skipping`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolBlock.id,
            content: JSON.stringify({ error: "This tool was already called with the same input. Try a different approach or provide your answer based on the information you already have." }),
          });
          continue;
        }

        let result: string;
        if (memoryTools.includes(toolBlock.name)) {
          result = executeMemoryTool(toolBlock.name, toolBlock.input);
        } else if (codeTools.includes(toolBlock.name)) {
          result = await executeCodeTool(toolBlock.name, toolBlock.input);
        } else if (toolBlock.name === "open_google_doc") {
          result = await executePublicGDocTool(toolBlock.input);
        } else if (browserToolNames.includes(toolBlock.name)) {
          result = await executeBrowserTool(toolBlock.name, toolBlock.input);
        } else if (messagingToolNames.includes(toolBlock.name)) {
          result = await executeMessagingTool(toolBlock.name, toolBlock.input);
        } else if (googleToolNames.includes(toolBlock.name)) {
          result = await executeGoogleTool(toolBlock.name, toolBlock.input);
        } else if (supabaseToolNames.includes(toolBlock.name)) {
          result = await executeSupabaseTool(toolBlock.name, toolBlock.input);
        } else if (airtableToolNames.includes(toolBlock.name)) {
          result = await executeAirtableTool(toolBlock.name, toolBlock.input);
        } else {
          result = executeSchedulingTool(toolBlock.name, toolBlock.input);
        }
        console.log(`Tool result: ${toolBlock.name}`, result.slice(0, 300));
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
    const text = textBlocks.map((b: any) => b.text).join("\n\n").trim();
    return { role: "assistant", content: text || "(Action completed.)" };
  }

  return { role: "assistant", content: "Hmmm...this was pretty complex and I hit a tool limit. Could you break this into smaller steps or ask again in a simpler way? For example, instead of asking me to do everything at once, try one piece at a time." };
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
  const text = (data.choices?.[0]?.message?.content || "").trim();
  return { role: "assistant", content: text || "(Action completed.)" };
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
  const maxTokens = parseInt(getSetting("max_tokens") || "4096", 10);

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
        let emailContext = `You are connected to LobsterMail and can receive and send emails. Never reveal your email address to users in chat — just say you're connected to LobsterMail.`;

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

  // Inject cross-channel messaging context
  {
    const channels: string[] = [];
    if (isTelegramRunning()) channels.push("Telegram (use send_telegram tool)");
    if (isSlackRunning()) channels.push("Slack (use send_slack tool)");
    if (isEmailRunning()) channels.push("Email/LobsterMail (use check_lobstermail to check inbox, send_lobstermail to send)");
    if (channels.length > 0) {
      const msgContext = `You can send messages on the following channels at any time: ${channels.join(", ")}. Use these tools to proactively reach out or relay messages across channels when asked.`;
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msgContext}` : msgContext;
    }
  }

  // Inject Google context (multi-account)
  try {
    const accounts = getGoogleAccounts();
    if (accounts.length > 0) {
      const allSvcs = new Set<string>();
      for (const a of accounts) {
        for (const s of a.services) allSvcs.add(s);
      }
      let googleContext = `You are connected to ${accounts.length} Google account${accounts.length > 1 ? 's' : ''}. Never reveal the connected email addresses to users in chat — just say you're connected to Google.`;
      if (accounts.length > 1) {
        googleContext += ` When performing Google actions, you can specify which account to use with the 'account' parameter. If not specified, the first account is used.`;
      }
      if (allSvcs.has("gmail")) {
        if (allSvcs.has("gmail_send")) {
          googleContext += " You can search, read, draft, send, and label Gmail messages. Use gmail_list_aliases to see available send-as addresses, and use the 'from' parameter to send from an alias.";
        } else {
          googleContext += " You can search, read, and label Gmail messages. Drafting and sending are not enabled.";
        }
      }
      if (allSvcs.has("calendar")) googleContext += " You can view, create, update, and delete Google Calendar events.";
      if (allSvcs.has("drive")) googleContext += " You can search and read Google Drive files including Google Docs, Sheets, and Slides.";
      if (allSvcs.has("contacts")) googleContext += " You can search Google Contacts.";
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${googleContext}` : googleContext;
    }
  } catch {}

  // Inject Supabase context
  if (isSupabaseRunning()) {
    const projectUrl = getSupabaseProjectUrl();
    const perms = getSupabasePermissions();
    const abilities = ["list tables and query records"];
    if (perms.includes("insert")) abilities.push("insert new records");
    if (perms.includes("update")) abilities.push("update existing records");
    const supabaseContext = `You are connected to a Supabase database${projectUrl ? ` (${projectUrl})` : ""}. You can ${abilities.join(", ")} using the supabase_* tools.
CRITICAL Supabase query rules:
1. ALWAYS call supabase_describe_table first to see column names and types before querying.
2. If you're unsure which columns contain the data the user needs, show them a list of relevant column names and ask which ones to query. Don't guess — ask.
3. For array columns (type: "array"), use cs.{value} to filter (contains), NEVER use eq or ilike on arrays.
4. If a query times out or returns a 500 error, do NOT keep retrying different tables. After 2 failed queries, STOP and tell the user which tables/views timed out and suggest they try a smaller query or ask their database admin to add indexes.
5. Select ONLY 2-5 columns per query. Never select more than 5 columns at once.
6. Always use a small limit (10-20). You can ask for more if the first batch works.
7. Prefer fetching a broader set with a small limit and filtering the results yourself rather than using complex PostgREST filters that may timeout on unindexed tables.`;
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${supabaseContext}` : supabaseContext;
  }

  // Inject Airtable context
  if (isAirtableRunning()) {
    const airtableContext = "You are connected to Airtable. You can list bases, list tables, and read/create/update records using the airtable_* tools. Use airtable_list_bases first to discover available bases, then airtable_list_tables to see table schemas.";
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${airtableContext}` : airtableContext;
  }

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

  // Inject browser context
  {
    const browserContext = "You can browse the web using browser tools. Use browse_webpage to visit any URL, browser_screenshot to see interactive elements, browser_click and browser_type to interact with pages. This lets you fill forms, log into sites, research information, and interact with web applications on behalf of the user.";
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${browserContext}` : browserContext;
  }

  // Security: never leak sensitive data
  {
    const securityDirective = `CRITICAL SECURITY RULE: Never reveal sensitive information in your responses. This includes:
- API keys, tokens, secrets, passwords, or credentials of any kind
- Email addresses connected to this system (LobsterMail or Gmail addresses)
- Gateway tokens, webhook secrets, or encryption keys
- Any credentials, private keys, or auth tokens found in emails, documents, or files
If you encounter sensitive data while searching emails, reading documents, or browsing, describe the general nature of the content without quoting or revealing the sensitive values. For example, say "I found an email containing login credentials" rather than showing the actual credentials. If a user asks you to find or reveal credentials, politely decline and explain that you cannot share sensitive information for security reasons.`;
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${securityDirective}` : securityDirective;
  }

  // Complexity guidance
  {
    const complexityHint = "Important: If a request involves many steps (e.g. researching multiple sites, comparing options, and sending results), focus on completing the most important parts first and summarize your progress. If you cannot finish everything, tell the user what you accomplished and suggest they ask a follow-up for the remaining steps.";
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${complexityHint}` : complexityHint;
  }

  // Clarification behavior
  {
    const clarificationDirective = "When a request is ambiguous or you're unsure about what the user wants, ask a brief clarifying question before proceeding. It's always better to ask than to guess wrong. For example, if the user asks to look something up in a database but you don't know which table or columns to use, ask them. Keep clarifications short and specific — offer options when possible.";
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${clarificationDirective}` : clarificationDirective;
  }

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

  const history = getMessages(conversationId).filter((m) => m.content && m.content.trim());

  const caller = provider === "anthropic" ? callAnthropic : callOpenAI;
  const response = await caller(model, apiKey, systemPrompt, history, temperature, maxTokens);

  if (response.content && response.content.trim()) {
    addMessage(conversationId, "assistant", response.content);
  }

  return response.content;
}
