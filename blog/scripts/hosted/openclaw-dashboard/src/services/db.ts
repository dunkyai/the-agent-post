import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../../data/openclaw.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema();
    seedDefaultShortcuts();
  }
  return db;
}

export function resetDb(): void {
  if (db) {
    db.close();
    db = undefined as any;
  }
}

function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL UNIQUE,
      config TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'disconnected',
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      integration_type TEXT NOT NULL,
      external_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_lookup
      ON conversations(integration_type, external_id);

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_rotated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL,
      prompt TEXT NOT NULL,
      target_source TEXT NOT NULL DEFAULT 'dashboard',
      target_external_id TEXT NOT NULL DEFAULT 'scheduler',
      enabled INTEGER NOT NULL DEFAULT 1,
      run_once INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT 'user',
      last_run TEXT,
      next_run TEXT,
      last_result TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS gmail_processed_threads (
      thread_id TEXT PRIMARY KEY,
      last_message_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'pending',
      active INTEGER NOT NULL DEFAULT 1,
      input TEXT NOT NULL DEFAULT '{}',
      intent TEXT NOT NULL DEFAULT '{}',
      context TEXT NOT NULL DEFAULT '{}',
      output TEXT NOT NULL DEFAULT '{}',
      execution TEXT NOT NULL DEFAULT '{}',
      conversation_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks(active);
    CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

    CREATE TABLE IF NOT EXISTS task_execution_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      input TEXT NOT NULL DEFAULT '{}',
      output TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_exec_log_task ON task_execution_log(task_id);

    CREATE TABLE IF NOT EXISTS confirmation_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_pattern TEXT NOT NULL,
      description TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS email_thread_state (
      thread_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'triaging',
      triage_result TEXT NOT NULL DEFAULT '{}',
      structured_request TEXT NOT NULL DEFAULT '{}',
      delivery_channel TEXT NOT NULL DEFAULT 'email',
      thread_subject TEXT NOT NULL DEFAULT '',
      latest_message_id TEXT NOT NULL DEFAULT '',
      latest_sender TEXT NOT NULL DEFAULT '',
      all_recipients TEXT NOT NULL DEFAULT '',
      message_id_header TEXT NOT NULL DEFAULT '',
      clarification_count INTEGER NOT NULL DEFAULT 0,
      reply_mode TEXT NOT NULL DEFAULT 'draft',
      task_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (thread_id, account_id)
    );
    CREATE INDEX IF NOT EXISTS idx_email_thread_state_state ON email_thread_state(state);

    CREATE TABLE IF NOT EXISTS slack_nudged_threads (
      external_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shortcuts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL,
      continuation_prompt TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_shortcuts_trigger ON shortcuts(trigger);

    CREATE TABLE IF NOT EXISTS pending_continuations (
      thread_id TEXT PRIMARY KEY,
      shortcut_id INTEGER NOT NULL,
      context TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shortcut_id) REFERENCES shortcuts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_state (
      thread_id TEXT PRIMARY KEY,
      shortcut_id INTEGER NOT NULL,
      steps TEXT NOT NULL,
      current_step INTEGER NOT NULL DEFAULT 0,
      step_results TEXT NOT NULL DEFAULT '{}',
      user_input TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      error_step INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shortcut_id) REFERENCES shortcuts(id) ON DELETE CASCADE
    );
  `);

  // Migrations: add columns to existing tables
  try { db.exec("ALTER TABLE scheduled_jobs ADD COLUMN run_once INTEGER NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE email_thread_state ADD COLUMN reply_mode TEXT NOT NULL DEFAULT 'draft'"); } catch {}
  try { db.exec("ALTER TABLE shortcuts ADD COLUMN continuation_prompt TEXT"); } catch {}
  try { db.exec("ALTER TABLE shortcuts ADD COLUMN workflow_steps TEXT"); } catch {}
}

const DEFAULT_SHORTCUTS = [
  {
    trigger: "coldemail",
    name: "Cold Email Outreach",
    description: "Research 10 prospects matching your ICP, build a lead list in Google Sheets, then draft personalized outreach emails after your approval.",
    prompt: `If the user provided ICP details, summarize them. Otherwise ask for target job titles, company size, industry, location, and their value proposition.`,
    continuation_prompt: `The user reviewed the prospect list. Draft ONE sample cold email template using {first_name}, {last_name}, {company} placeholders. Show it and ask for approval before drafting in Gmail.

After approval, read the spreadsheet with sheets_read, create gmail_create_draft for each prospect with an email, and update the Status column to "Drafted".`,
    workflow_steps: JSON.stringify([
      {
        type: "ai",
        id: "clarify",
        prompt: `You are a customer acquisition specialist. The user wants cold outreach. Their request: "{{input}}"

If they provided enough detail (target titles, industry, and what they're selling), respond with ONLY a JSON object:
{"ready": true, "icp": "<summary of ideal customer profile>", "query": "<search query for finding prospects>"}

If too vague, respond with ONLY:
{"ready": false, "question": "<ask for missing ICP details: job titles, company size, industry, location, value prop>"}`,
        label: "Understanding ICP",
      },
      {
        type: "ai",
        id: "research",
        prompt: `You are a prospect researcher. Find 10 real people matching this ICP:

ICP: {{step.clarify.result}}
User request: {{input}}

INSTRUCTIONS:
1. Try contactout_search_people first. If ContactOut errors, switch to web_search immediately.
2. For each prospect find: first_name, last_name, title, company, email (blank if not found)
3. Use web_search to find company team pages, LinkedIn profiles, conference speakers
4. Return findings as JSON array: [{"first_name":"...","last_name":"...","title":"...","company":"...","email":"...","notes":"..."}, ...]

You MUST call contactout_search_people or web_search. Do NOT generate prospects from memory. Every name must come from a tool call.`,
        label: "Researching prospects",
        tools: true,
      },
      {
        type: "system",
        id: "create_sheet",
        tool: "sheets_create",
        input: { title: "Cold Outreach — {{step.clarify.result.icp}} — {{date}}" },
        label: "Creating spreadsheet",
      },
      {
        type: "ai",
        id: "populate",
        prompt: `Write the prospect data to the spreadsheet.

Prospects: {{step.research.result}}
Spreadsheet ID: {{step.create_sheet.result.spreadsheetId}}

Use sheets_write to:
1. Write headers in row 1: First Name, Last Name, Title, Company, Email, Status, Notes
2. Write all prospect data starting row 2

After writing, share the spreadsheet URL and summarize: how many found, how many have emails. Then say: "Take a look. If it looks good, let me know and I'll draft a personalized email for your approval."`,
        label: "Populating spreadsheet",
        tools: true,
      },
    ]),
  },
  {
    trigger: "createevent",
    name: "Create Luma Event",
    description: "Walk through creating a new Luma event step by step",
    prompt: `You are helping the user create a new event on Luma. Walk them through it step by step.

Ask for the following details ONE AT A TIME (do not ask all at once):
1. Event name/title
2. Date and time (with timezone — use their configured timezone)
3. Is it virtual or in-person? If in-person, ask for the location/address. If virtual, ask if they want to add a meeting URL.
4. Event description/copy — offer to help write it if they give you a topic

After gathering all details, summarize what you will create and ask for confirmation before calling luma_create_event.

After creating the event, ALWAYS share the event URL with the user so they can view and share it.

{{input}}`,
    continuation_prompt: null,
  },
  {
    trigger: "research",
    name: "Research & Spreadsheet",
    description: "Research any topic and compile results into a Google Spreadsheet",
    prompt: `If the user provided a clear research topic, summarize it. If not, ask what they want to research.`,
    continuation_prompt: null,
    workflow_steps: JSON.stringify([
      {
        type: "ai",
        id: "clarify",
        prompt: `You are a research assistant. The user wants to research a topic. Their request: "{{input}}"

If the request is clear enough to research (has a topic, and optionally location/criteria), respond with ONLY a JSON object (no other text):
{"ready": true, "query": "<the main search query>", "topic": "<short topic label>", "columns": ["Name", "<col2>", "<col3>", ...]}

Pick columns appropriate for the topic (e.g. hotels: Name, Location, Price, Rating, URL; companies: Name, Industry, Size, Website; restaurants: Name, Cuisine, Price Range, Rating, Address, URL).

If the request is too vague, respond with ONLY:
{"ready": false, "question": "<one clarifying question>"}`,
        label: "Understanding request",
      },
      {
        type: "ai",
        id: "research",
        prompt: `You are a research assistant. Research the following topic using web_search and browse_webpage tools.

Topic: {{input}}
Search query: {{step.clarify.result}}

INSTRUCTIONS:
1. Call web_search multiple times with different queries to find 10-15 results
2. Call browse_webpage on promising URLs to get detailed information
3. For each result, gather: name, and any relevant details (price, rating, location, URL, etc.)
4. Return your findings as a JSON array: [{"name": "...", "col2": "...", ...}, ...]

You MUST call web_search. Do NOT generate results from memory. Every data point must come from a tool call.`,
        label: "Researching",
        tools: true,
      },
      {
        type: "system",
        id: "create_sheet",
        tool: "sheets_create",
        input: { title: "Research — {{step.clarify.result.topic}} — {{date}}" },
        label: "Creating spreadsheet",
      },
      {
        type: "ai",
        id: "populate",
        prompt: `You have research results and a Google Spreadsheet. Write the data to the spreadsheet.

Research results: {{step.research.result}}
Spreadsheet ID: {{step.create_sheet.result.spreadsheetId}}

Use sheets_write to:
1. Write column headers in row 1
2. Write all research data starting from row 2

After writing, respond with the spreadsheet URL and a brief summary of what you found.`,
        label: "Populating spreadsheet",
        tools: true,
      },
    ]),
  },
  {
    trigger: "jobdesc",
    name: "Job Description Generator",
    description: "Research comparable roles and generate a polished job description in Google Docs.",
    prompt: `If the user provided role details, summarize them. Otherwise ask for: job title, seniority, responsibilities, required skills, work arrangement, and salary range.`,
    continuation_prompt: `The user reviewed the job description and wants changes. Use docs_read to get current content, then docs_suggest_edit or docs_insert to make changes. Share the updated link.`,
    workflow_steps: JSON.stringify([
      {
        type: "ai",
        id: "clarify",
        prompt: `You are an HR specialist. The user wants to create a job description. Their request: "{{input}}"

If they provided enough detail (at minimum: job title and some responsibilities or context), respond with ONLY a JSON object:
{"ready": true, "title": "<job title>", "query": "<search query for comparable job postings>"}

If too vague, respond with ONLY:
{"ready": false, "question": "<ask for: job title, seniority, key responsibilities, must-have skills>"}`,
        label: "Understanding role",
      },
      {
        type: "ai",
        id: "research",
        prompt: `Research comparable job postings and market data for this role.

Role: {{input}}
Job title: {{step.clarify.result}}

INSTRUCTIONS:
1. Call web_search to find 3-5 comparable job postings for this role
2. Call browse_webpage on the most relevant postings to extract: common responsibilities, required skills, salary ranges
3. Summarize your findings as JSON: {"comparable_salary": "...", "common_requirements": [...], "common_responsibilities": [...], "market_insights": "..."}

You MUST call web_search. Do NOT generate job description content from memory alone.`,
        label: "Researching comparable roles",
        tools: true,
      },
      {
        type: "ai",
        id: "write_jd",
        prompt: `Write a complete job description using the research data and user's requirements.

User request: {{input}}
Research: {{step.research.result}}

Write the FULL job description with these sections ONLY:
1. About [Company Name] — 2-3 sentences (use context from memory/system prompt about the user's company)
2. The Role — 2-3 sentence overview
3. What You'll Do — 6-8 bullet points
4. What We're Looking For — 5-7 required qualifications
5. Nice to Have — 3-5 preferred qualifications
6. Compensation & Benefits — salary range from research, standard benefits
7. How to Apply — brief closing

Tone: professional but approachable. No jargon like "rockstar" or "ninja". Use inclusive language. Be specific.

Return the full text content (not JSON).`,
        label: "Writing job description",
      },
      {
        type: "system",
        id: "create_doc",
        tool: "docs_create",
        input: { title: "{{step.clarify.result.title}} — Job Description", content: "{{step.write_jd.result}}" },
        label: "Creating Google Doc",
      },
      {
        type: "pause",
        id: "review",
        message: "Here's your job description: {{step.create_doc.result.documentUrl}}\n\nTake a look and let me know if you'd like any changes!",
        label: "Ready for review",
      },
    ]),
  },
  {
    trigger: "amplify",
    name: "Amplify Content",
    description: "Turn a voice note or written content into social posts, save to Google Docs, and publish via Buffer/Twitter.",
    prompt: `You are a social media content specialist. The user wants to turn their ideas into polished social media content.

{{input}}

**If the user has NOT provided any content yet** (no text, no audio attachment, {{input}} is empty or just whitespace), ask them:

"What content would you like me to amplify? You can:
1. **Record a voice note** — hit the mic button and share your thoughts
2. **Paste your content** — copy and paste text, a blog post, notes, etc.
3. **Share a URL** — I'll read the page and work from that

What would you like to do?"

Do NOT proceed until the user provides content. Wait for their reply.

**If the user HAS provided content** (text after the trigger, an audio attachment, or a URL), proceed immediately:

1. If audio is attached, the transcription is already included above — use it as the source content.
2. If a URL is provided, use browse_webpage to read the page content.
3. Create the following in a Google Doc titled "Social Content — [brief topic] — [today's date]":

**LinkedIn Post**
- Professional but conversational tone
- 3-4 paragraphs with line breaks for readability
- No hashtags
- Hook in the first line

**Twitter/X Thread**
- 5-7 tweets, each under 280 characters
- Numbered (1/, 2/, etc.)
- First tweet is the hook
- Last tweet is a CTA or takeaway

4. Share the Google Doc link and ask:
"Here's your content draft — please review it. When you're ready, tell me:
1. Which channels to post to (LinkedIn, Twitter/X, or both)
2. When to post (now, or a specific date/time)
3. Any edits you'd like first"`,
    continuation_prompt: `The user has reviewed the content and wants to proceed.

Based on their reply:

**If they want edits:** Update the Google Doc with their changes using docs_read then docs_replace_text. Share the updated link and ask again about publishing.

**If they want to publish:**
1. Use buffer_list_channels to see available channels
2. For LinkedIn: use buffer_create_post with the LinkedIn channel ID and the LinkedIn post content. If scheduling, use the due_at parameter.
3. For Twitter/X: use twitter_post_thread with the thread content. Post immediately (no scheduling).
4. If a channel is not connected, tell the user which integration they need to set up in Settings → Integrations.

Publish exactly what was written in the Google Doc. Do NOT modify the content.

After publishing, confirm what was posted and where.`,
  },
];

function seedDefaultShortcuts(): void {
  const upsert = db.prepare(
    `INSERT INTO shortcuts (trigger, name, description, prompt, continuation_prompt, workflow_steps)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(trigger) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       prompt = excluded.prompt,
       continuation_prompt = excluded.continuation_prompt,
       workflow_steps = excluded.workflow_steps,
       updated_at = datetime('now')`
  );
  for (const s of DEFAULT_SHORTCUTS) {
    upsert.run(s.trigger, s.name, s.description, s.prompt, s.continuation_prompt || null, (s as any).workflow_steps || null);
  }
}

export function getGmailProcessedThread(threadId: string): { last_message_id: string } | undefined {
  return getDb().prepare("SELECT last_message_id FROM gmail_processed_threads WHERE thread_id = ?").get(threadId) as
    | { last_message_id: string }
    | undefined;
}

export function markGmailThreadProcessed(threadId: string, lastMessageId: string, accountId: string): void {
  getDb()
    .prepare("INSERT INTO gmail_processed_threads (thread_id, last_message_id, account_id) VALUES (?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET last_message_id = ?, processed_at = datetime('now')")
    .run(threadId, lastMessageId, accountId, lastMessageId);
}

// --- Email Thread State ---

export interface EmailThreadStateRow {
  thread_id: string;
  account_id: string;
  state: string;
  triage_result: string;
  structured_request: string;
  delivery_channel: string;
  thread_subject: string;
  latest_message_id: string;
  latest_sender: string;
  all_recipients: string;
  message_id_header: string;
  clarification_count: number;
  reply_mode: string;
  task_id: string | null;
  created_at: string;
  updated_at: string;
}

export function getEmailThreadState(threadId: string, accountId: string): EmailThreadStateRow | undefined {
  return getDb()
    .prepare("SELECT * FROM email_thread_state WHERE thread_id = ? AND account_id = ?")
    .get(threadId, accountId) as EmailThreadStateRow | undefined;
}

export function upsertEmailThreadState(
  threadId: string,
  accountId: string,
  updates: Partial<Omit<EmailThreadStateRow, "thread_id" | "account_id" | "created_at">>
): void {
  // Security: whitelist allowed column names to prevent SQL injection via dynamic keys
  const ALLOWED_EMAIL_STATE_COLS = new Set([
    "state", "triage_result", "structured_request", "delivery_channel",
    "thread_subject", "latest_message_id", "latest_sender", "all_recipients",
    "message_id_header", "clarification_count", "reply_mode", "task_id",
  ]);

  const existing = getEmailThreadState(threadId, accountId);
  if (existing) {
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && ALLOWED_EMAIL_STATE_COLS.has(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    values.push(threadId, accountId);
    getDb()
      .prepare(`UPDATE email_thread_state SET ${fields.join(", ")} WHERE thread_id = ? AND account_id = ?`)
      .run(...values);
  } else {
    const cols = ["thread_id", "account_id"];
    const vals: unknown[] = [threadId, accountId];
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && ALLOWED_EMAIL_STATE_COLS.has(key)) {
        cols.push(key);
        vals.push(value);
      }
    }
    const placeholders = cols.map(() => "?").join(", ");
    getDb()
      .prepare(`INSERT INTO email_thread_state (${cols.join(", ")}) VALUES (${placeholders})`)
      .run(...vals);
  }
}

export function getStaleAwaitingReplyThreads(cutoffHours: number): EmailThreadStateRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM email_thread_state
       WHERE state = 'awaiting_reply'
       AND updated_at < datetime('now', '-' || ? || ' hours')`
    )
    .all(cutoffHours) as EmailThreadStateRow[];
}

export function isKnownSender(email: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM email_thread_state
       WHERE lower(latest_sender) LIKE '%' || ? || '%'
       AND state IN ('delivered', 'processing', 'awaiting_reply')
       LIMIT 1`
    )
    .get(email.toLowerCase()) as any;
  return !!row;
}

export function getSetting(key: string): string | undefined {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?")
    .run(key, value, value);
}

export function deleteSetting(key: string): void {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export function getIntegration(type: string) {
  return getDb().prepare("SELECT * FROM integrations WHERE type = ?").get(type) as
    | { id: number; type: string; config: string; status: string; error_message: string | null }
    | undefined;
}

export function upsertIntegration(
  type: string,
  config: string,
  status: string,
  errorMessage?: string
): void {
  getDb()
    .prepare(
      `INSERT INTO integrations (type, config, status, error_message)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(type) DO UPDATE SET config = ?, status = ?, error_message = ?`
    )
    .run(type, config, status, errorMessage ?? null, config, status, errorMessage ?? null);
}

export function getAllIntegrations() {
  return getDb().prepare("SELECT * FROM integrations").all() as {
    id: number;
    type: string;
    config: string;
    status: string;
    error_message: string | null;
  }[];
}

export function getGoogleIntegrations() {
  return getDb().prepare("SELECT * FROM integrations WHERE type LIKE 'google:%'").all() as {
    id: number;
    type: string;
    config: string;
    status: string;
    error_message: string | null;
  }[];
}

export function deleteIntegration(type: string): void {
  getDb().prepare("DELETE FROM integrations WHERE type = ?").run(type);
}

export function getOrCreateConversation(integrationType: string, externalId: string): string {
  const existing = getDb()
    .prepare("SELECT id FROM conversations WHERE integration_type = ? AND external_id = ?")
    .get(integrationType, externalId) as { id: string } | undefined;

  if (existing) {
    getDb()
      .prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?")
      .run(existing.id);
    return existing.id;
  }

  const { v4: uuidv4 } = require("uuid");
  const id = uuidv4();
  getDb()
    .prepare("INSERT INTO conversations (id, integration_type, external_id) VALUES (?, ?, ?)")
    .run(id, integrationType, externalId);
  return id;
}

export function addMessage(conversationId: string, role: string, content: string): void {
  getDb()
    .prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)")
    .run(conversationId, role, content);
}

export function getMessages(conversationId: string, limit = 50) {
  return getDb()
    .prepare(
      "SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?"
    )
    .all(conversationId, limit) as { role: string; content: string; created_at: string }[];
}

export function deleteConversation(conversationId: string): void {
  getDb().prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
  getDb().prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
}

export function getConversationsByType(integrationType: string) {
  return getDb()
    .prepare(
      "SELECT id, external_id, updated_at FROM conversations WHERE integration_type = ? ORDER BY updated_at DESC"
    )
    .all(integrationType) as { id: string; external_id: string; updated_at: string }[];
}

// --- Scheduled Jobs ---

export interface ScheduledJob {
  id: number;
  name: string;
  schedule: string;
  prompt: string;
  target_source: string;
  target_external_id: string;
  enabled: number;
  run_once: number;
  created_by: string;
  last_run: string | null;
  next_run: string | null;
  last_result: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function createScheduledJob(job: {
  name: string;
  schedule: string;
  prompt: string;
  target_source?: string;
  target_external_id?: string;
  enabled?: number;
  run_once?: number;
  created_by?: string;
  next_run: string;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO scheduled_jobs (name, schedule, prompt, target_source, target_external_id, enabled, run_once, created_by, next_run)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      job.name,
      job.schedule,
      job.prompt,
      job.target_source || "dashboard",
      job.target_external_id || "scheduler",
      job.enabled ?? 1,
      job.run_once ?? 0,
      job.created_by || "user",
      job.next_run
    );
  return result.lastInsertRowid as number;
}

export function getScheduledJob(id: number): ScheduledJob | undefined {
  return getDb().prepare("SELECT * FROM scheduled_jobs WHERE id = ?").get(id) as ScheduledJob | undefined;
}

export function getMonthlyTaskCount(): number {
  const now = new Date();
  const startOfMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01 00:00:00`;
  const row = getDb().prepare(
    "SELECT COUNT(*) as count FROM tasks WHERE status = 'completed' AND created_at >= ?"
  ).get(startOfMonth) as { count: number };
  return row.count;
}

export function getAllScheduledJobs(): ScheduledJob[] {
  return getDb()
    .prepare("SELECT * FROM scheduled_jobs ORDER BY created_at DESC")
    .all() as ScheduledJob[];
}

export function getDueJobs(): ScheduledJob[] {
  return getDb()
    .prepare(
      "SELECT * FROM scheduled_jobs WHERE enabled = 1 AND next_run IS NOT NULL AND replace(replace(next_run, 'T', ' '), '.000Z', '') <= datetime('now')"
    )
    .all() as ScheduledJob[];
}

export function updateScheduledJob(
  id: number,
  updates: Partial<Pick<ScheduledJob, "name" | "schedule" | "prompt" | "target_source" | "target_external_id" | "enabled" | "next_run">>
): void {
  const ALLOWED_JOB_COLS = new Set(["name", "schedule", "prompt", "target_source", "target_external_id", "enabled", "next_run"]);
  const fields: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && ALLOWED_JOB_COLS.has(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  getDb()
    .prepare(`UPDATE scheduled_jobs SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values);
}

export function markJobRun(id: number, result: string | null, error: string | null, nextRun: string): void {
  getDb()
    .prepare(
      `UPDATE scheduled_jobs
       SET last_run = datetime('now'), last_result = ?, last_error = ?, next_run = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(result ? result.slice(0, 500) : null, error, nextRun, id);
}

export function deleteScheduledJob(id: number): void {
  getDb().prepare("DELETE FROM scheduled_jobs WHERE id = ?").run(id);
}

// --- Memories ---

export interface Memory {
  id: number;
  content: string;
  created_at: string;
}

export function addMemory(content: string): number {
  const result = getDb()
    .prepare("INSERT INTO memories (content) VALUES (?)")
    .run(content);
  return result.lastInsertRowid as number;
}

/**
 * Check if a substantially similar memory already exists.
 * Returns the matching memory if found, undefined otherwise.
 * Uses normalized word overlap — if 60%+ of words match, it's a duplicate.
 */
export function findDuplicateMemory(content: string): Memory | undefined {
  const memories = getAllMemories();
  const normalizeWords = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2);
  const newWords = new Set(normalizeWords(content));
  if (newWords.size === 0) return undefined;

  for (const mem of memories) {
    const existingWords = new Set(normalizeWords(mem.content));
    if (existingWords.size === 0) continue;
    // Count overlap
    let overlap = 0;
    for (const w of newWords) {
      if (existingWords.has(w)) overlap++;
    }
    const overlapRatio = overlap / Math.min(newWords.size, existingWords.size);
    if (overlapRatio >= 0.6) return mem;
  }
  return undefined;
}

export function getAllMemories(): Memory[] {
  return getDb()
    .prepare("SELECT * FROM memories ORDER BY created_at ASC")
    .all() as Memory[];
}

export function deleteMemory(id: number): void {
  getDb().prepare("DELETE FROM memories WHERE id = ?").run(id);
}

export function getMemory(id: number): Memory | undefined {
  return getDb().prepare("SELECT * FROM memories WHERE id = ?").get(id) as Memory | undefined;
}

/**
 * Daily memory cleanup: remove exact duplicates and operational logs.
 * NEVER removes user preferences, rules, or explicit "remember this" entries.
 * Returns count of removed memories.
 */
export function cleanupMemories(): number {
  const memories = getAllMemories();
  const toDelete: number[] = [];
  const seen = new Map<string, number>(); // normalized content → first ID

  // Patterns that indicate operational logs (action confirmations, not preferences)
  const operationalPatterns = [
    /^successfully\s+(posted|created|sent|queued|scheduled|updated|deleted|drafted)/i,
    /^created google (spreadsheet|doc|document)/i,
    /^posted \d+-tweet thread/i,
    /^queued linkedin post/i,
    /^user (posted|queued|asked warren to create|asked warren to search|requested warren hippo to create a tweet)/i,
    /^workflow ".*" completed\./i,
  ];

  // Patterns that indicate preferences/rules — NEVER delete these
  const preferencePatterns = [
    /user prefers/i,
    /user requested.*to (avoid|stop|keep|make|only|never|always)/i,
    /\b(always|never|important|must)\b.*\b(respond|reply|use|format|show|draft|send)\b/i,
    /\bformat\b.*\bprefer/i,
    /\bno (bold|hashtag|emoji)/i,
  ];

  for (const mem of memories) {
    // Normalize for dedup comparison
    const normalized = mem.content.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

    // 1. Exact duplicate check (keep the first, delete later ones)
    if (seen.has(normalized)) {
      toDelete.push(mem.id);
      continue;
    }
    seen.set(normalized, mem.id);

    // 2. Near-duplicate check (60%+ word overlap with an earlier memory)
    const words = new Set(normalized.split(" ").filter(w => w.length > 2));
    let isDuplicate = false;
    for (const [seenNorm, seenId] of seen) {
      if (seenId === mem.id) continue;
      const seenWords = new Set(seenNorm.split(" ").filter(w => w.length > 2));
      if (seenWords.size === 0 || words.size === 0) continue;
      let overlap = 0;
      for (const w of words) {
        if (seenWords.has(w)) overlap++;
      }
      const ratio = overlap / Math.min(words.size, seenWords.size);
      if (ratio >= 0.75) {
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) {
      // Only delete if it's NOT a preference/rule
      const isPreference = preferencePatterns.some(p => p.test(mem.content));
      if (!isPreference) {
        toDelete.push(mem.id);
        continue;
      }
    }

    // 3. Operational log check — remove action confirmations
    const isOperational = operationalPatterns.some(p => p.test(mem.content));
    if (isOperational) {
      // Double-check it's not also a preference
      const isPreference = preferencePatterns.some(p => p.test(mem.content));
      if (!isPreference) {
        toDelete.push(mem.id);
      }
    }
  }

  // Delete in batch
  if (toDelete.length > 0) {
    const placeholders = toDelete.map(() => "?").join(",");
    getDb().prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...toDelete);
  }

  return toDelete.length;
}

// --- Sessions ---

export function createSessionToken(): string {
  const token = crypto.randomBytes(32).toString("hex");
  const expiryDays = parseInt(getSetting("session_expiry_days") || "30", 10);
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
  getDb()
    .prepare("INSERT INTO sessions (token, expires_at) VALUES (?, ?)")
    .run(token, expiresAt);
  return token;
}

export function validateSession(token: string): boolean {
  if (!token) return false;
  const row = getDb()
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token) as { token: string; expires_at: string; last_rotated_at: string } | undefined;
  if (!row) return false;
  if (new Date(row.expires_at) < new Date()) {
    getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return false;
  }
  return true;
}

export function rotateSessionToken(oldToken: string): string | null {
  const row = getDb()
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(oldToken) as { token: string; last_rotated_at: string; expires_at: string } | undefined;
  if (!row) return null;

  // Only rotate if last rotation was >24h ago
  const lastRotated = new Date(row.last_rotated_at).getTime();
  if (Date.now() - lastRotated < 24 * 60 * 60 * 1000) return null;

  const newToken = crypto.randomBytes(32).toString("hex");
  getDb().prepare(
    "UPDATE sessions SET token = ?, last_rotated_at = datetime('now') WHERE token = ?"
  ).run(newToken, oldToken);
  return newToken;
}

export function deleteSession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function cleanExpiredSessions(): number {
  const result = getDb()
    .prepare("DELETE FROM sessions WHERE expires_at < datetime('now')")
    .run();
  return result.changes;
}

// --- Tasks ---

import { generateTaskId, type TaskStatus, type CreateTaskParams, type ExecutionLogEntry } from "../types/task";

interface TaskRow {
  task_id: string;
  created_at: string;
  updated_at: string;
  status: string;
  active: number;
  input: string;
  intent: string;
  context: string;
  output: string;
  execution: string;
  conversation_id: string | null;
}

export { generateTaskId };

export function insertTask(params: CreateTaskParams): string {
  const taskId = generateTaskId();
  const input = JSON.stringify({
    raw_input: params.raw_input,
    source_channel: params.source_channel,
    metadata: params.metadata || {},
  });
  const output = JSON.stringify({
    reply_channel: params.reply_channel,
  });
  getDb()
    .prepare(
      `INSERT INTO tasks (task_id, input, output, conversation_id)
       VALUES (?, ?, ?, ?)`
    )
    .run(taskId, input, output, params.conversation_id || null);
  return taskId;
}

export function getTask(taskId: string): TaskRow | undefined {
  return getDb()
    .prepare("SELECT * FROM tasks WHERE task_id = ?")
    .get(taskId) as TaskRow | undefined;
}

export function updateTask(
  taskId: string,
  updates: Partial<{
    status: TaskStatus;
    active: number;
    intent: string;
    context: string;
    output: string;
    execution: string;
    conversation_id: string;
  }>
): void {
  const ALLOWED_TASK_COLS = new Set(["status", "active", "intent", "context", "output", "execution", "conversation_id"]);
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && ALLOWED_TASK_COLS.has(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(taskId);
  getDb()
    .prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE task_id = ?`)
    .run(...values);
}

export function getPendingTasks(): TaskRow[] {
  return getDb()
    .prepare("SELECT * FROM tasks WHERE status = 'pending' AND active = 1 ORDER BY created_at ASC")
    .all() as TaskRow[];
}

export function getRecentTasks(limit = 50, offset = 0): TaskRow[] {
  return getDb()
    .prepare("SELECT * FROM tasks WHERE active = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as TaskRow[];
}

export function countActiveTasks(): number {
  const row = getDb().prepare("SELECT COUNT(*) as cnt FROM tasks WHERE active = 1").get() as any;
  return row?.cnt || 0;
}

export function appendExecutionLog(
  taskId: string,
  entry: Omit<ExecutionLogEntry, "timestamp">
): void {
  getDb()
    .prepare(
      `INSERT INTO task_execution_log (task_id, tool, input, output, duration_ms)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      taskId,
      entry.tool,
      JSON.stringify(entry.input),
      entry.output,
      entry.duration_ms
    );
}

export function getExecutionLog(taskId: string) {
  return getDb()
    .prepare(
      "SELECT * FROM task_execution_log WHERE task_id = ? ORDER BY created_at ASC"
    )
    .all(taskId) as {
    id: number;
    task_id: string;
    tool: string;
    input: string;
    output: string;
    duration_ms: number;
    created_at: string;
  }[];
}

export function deactivateOldTasks(days: number): number {
  const result = getDb()
    .prepare(
      `UPDATE tasks SET active = 0, updated_at = datetime('now')
       WHERE active = 1
       AND status IN ('completed', 'failed', 'cancelled')
       AND updated_at < datetime('now', '-' || ? || ' days')`
    )
    .run(days);
  return result.changes;
}

export function markStuckTasksFailed(): number {
  const result = getDb()
    .prepare(
      `UPDATE tasks SET status = 'failed', active = 1, updated_at = datetime('now'),
       execution = json_set(COALESCE(execution, '{}'), '$.error', 'Task was stuck in processing state on restart')
       WHERE status = 'processing'`
    )
    .run();
  return result.changes;
}

export function getConfirmationRules() {
  return getDb()
    .prepare("SELECT * FROM confirmation_rules WHERE enabled = 1")
    .all() as {
    id: number;
    tool_pattern: string;
    description: string;
    enabled: number;
  }[];
}

// --- Shortcuts ---

export interface Shortcut {
  id: number;
  trigger: string;
  name: string;
  description: string;
  prompt: string;
  continuation_prompt: string | null;
  workflow_steps: string | null;
  created_at: string;
  updated_at: string;
}

export function getAllShortcuts(): Shortcut[] {
  return getDb().prepare("SELECT * FROM shortcuts ORDER BY created_at DESC").all() as Shortcut[];
}

export function getShortcut(id: number): Shortcut | undefined {
  return getDb().prepare("SELECT * FROM shortcuts WHERE id = ?").get(id) as Shortcut | undefined;
}

export function getShortcutByTrigger(trigger: string): Shortcut | undefined {
  return getDb().prepare("SELECT * FROM shortcuts WHERE trigger = ?").get(trigger) as Shortcut | undefined;
}

export function createShortcut(trigger: string, name: string, description: string, prompt: string, continuationPrompt?: string, workflowSteps?: string): void {
  getDb()
    .prepare("INSERT INTO shortcuts (trigger, name, description, prompt, continuation_prompt, workflow_steps) VALUES (?, ?, ?, ?, ?, ?)")
    .run(trigger, name, description, prompt, continuationPrompt || null, workflowSteps || null);
}

export function updateShortcut(id: number, updates: { trigger?: string; name?: string; description?: string; prompt?: string; continuation_prompt?: string | null; workflow_steps?: string | null }): void {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.trigger !== undefined) { fields.push("trigger = ?"); values.push(updates.trigger); }
  if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
  if (updates.description !== undefined) { fields.push("description = ?"); values.push(updates.description); }
  if (updates.prompt !== undefined) { fields.push("prompt = ?"); values.push(updates.prompt); }
  if (updates.continuation_prompt !== undefined) { fields.push("continuation_prompt = ?"); values.push(updates.continuation_prompt); }
  if (updates.workflow_steps !== undefined) { fields.push("workflow_steps = ?"); values.push(updates.workflow_steps); }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE shortcuts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteShortcut(id: number): void {
  getDb().prepare("DELETE FROM shortcuts WHERE id = ?").run(id);
}

// --- Workflow State ---

export function getWorkflowState(threadId: string): import("../types/workflow").WorkflowState | undefined {
  return getDb().prepare("SELECT * FROM workflow_state WHERE thread_id = ?").get(threadId) as import("../types/workflow").WorkflowState | undefined;
}

export function upsertWorkflowState(threadId: string, data: Partial<import("../types/workflow").WorkflowState> & { shortcut_id: number }): void {
  const existing = getWorkflowState(threadId);
  if (existing) {
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: any[] = [];
    const allowed = ["steps", "current_step", "step_results", "user_input", "status", "error_step"];
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    values.push(threadId);
    getDb().prepare(`UPDATE workflow_state SET ${fields.join(", ")} WHERE thread_id = ?`).run(...values);
  } else {
    getDb().prepare(
      "INSERT INTO workflow_state (thread_id, shortcut_id, steps, current_step, step_results, user_input, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      threadId,
      data.shortcut_id,
      data.steps || "[]",
      data.current_step || 0,
      data.step_results || "{}",
      data.user_input || "",
      data.status || "running"
    );
  }
}

export function deleteWorkflowState(threadId: string): void {
  getDb().prepare("DELETE FROM workflow_state WHERE thread_id = ?").run(threadId);
}

// --- Pending Continuations ---

export function setPendingContinuation(threadId: string, shortcutId: number, context: Record<string, any> = {}): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO pending_continuations (thread_id, shortcut_id, context) VALUES (?, ?, ?)")
    .run(threadId, shortcutId, JSON.stringify(context));
}

export function getPendingContinuation(threadId: string): { shortcut_id: number; context: string } | undefined {
  return getDb()
    .prepare("SELECT shortcut_id, context FROM pending_continuations WHERE thread_id = ?")
    .get(threadId) as { shortcut_id: number; context: string } | undefined;
}

export function deletePendingContinuation(threadId: string): void {
  getDb().prepare("DELETE FROM pending_continuations WHERE thread_id = ?").run(threadId);
}

/**
 * Check if a message starts with a shortcut trigger (;trigger).
 * Returns the expanded prompt with {{input}} replaced, or null if no match.
 */
export function expandShortcut(message: string, hasAttachments = false): { shortcut: Shortcut; expanded: string } | null {
  const trimmed = message.trim();

  // Find ;trigger anywhere in the text (may be preceded by transcription, @mentions, etc.)
  // Also match spoken "semicolon trigger" from audio transcription
  let normalized = trimmed.replace(/\bsemicolon\s+/gi, ";");
  const match = normalized.match(/(?:^|\s);(\S+)/);
  if (!match) return null;

  const trigger = match[1].toLowerCase();
  const shortcut = getShortcutByTrigger(trigger);
  if (!shortcut) return null;

  // Text before the ;trigger (e.g. audio transcriptions) and after it are both context
  const matchStart = normalized.indexOf(match[0]);
  const matchEnd = matchStart + match[0].length;
  const before = normalized.slice(0, matchStart).trim();
  const after = normalized.slice(matchEnd).trim();
  const input = [before, after].filter(Boolean).join("\n\n");

  // If no input and no attachments — for workflow shortcuts, still return the match
  // so the adapter can set up a "prompting" workflow state. For prompt shortcuts, ask for clarification.
  if (!input && !hasAttachments) {
    if (shortcut.workflow_steps) {
      // Workflow shortcut — return with empty input, the workflow executor will handle it
      return { shortcut, expanded: "" };
    }
    const expanded = `The user typed ;${shortcut.trigger} but didn't provide any content, context, or attachments. `
      + `This shortcut ("${shortcut.name}") needs input to work with. `
      + `Ask the user what they'd like to ${shortcut.description || "do with this shortcut"}. `
      + `Be specific about what kind of input you need (e.g. audio file, text notes, a URL, a topic).`;
    return { shortcut, expanded };
  }

  let expanded = shortcut.prompt;
  const hasInputPlaceholder = expanded.includes("{{input}}");
  expanded = expanded.replace(/\{\{input\}\}/g, input || "");
  expanded = expanded.replace(/\{\{attachments\}\}/g, hasAttachments ? "with attached files" : "");
  // Clean up double spaces from empty replacements
  expanded = expanded.replace(/  +/g, " ").trim();
  // If there's context (e.g. audio transcription) but no {{input}} placeholder, append it
  if (input && !hasInputPlaceholder) {
    expanded += `\n\nCONTEXT:\n${input}`;
  }

  // Wrap with strict execution instructions — remove AI judgement about which steps to follow
  const phaseNote = shortcut.continuation_prompt
    ? `\n\nIMPORTANT: This is Phase 1 of a 2-phase workflow. After completing these steps, ask the user to review the output and reply when ready to proceed. Do NOT execute Phase 2 actions (publishing, posting, sending) — that happens after approval.`
    : "";
  expanded = `[SHORTCUT WORKFLOW: "${shortcut.name}"${shortcut.continuation_prompt ? " — Phase 1" : ""}]\n\n`
    + `The following is a predefined workflow. You MUST execute EVERY instruction below literally and in order. `
    + `Do NOT skip, combine, or reinterpret any step. Do NOT put content inline that the instructions say to put in a document or other tool. `
    + `If the instructions say to create a Google Doc, you MUST call the google_docs_create tool. `
    + `If the instructions say to post a link, you MUST include the link in your response. `
    + `Complete every step before responding.${phaseNote}\n\n`
    + `INSTRUCTIONS:\n${expanded}`;

  return { shortcut, expanded };
}
