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
  }
  return db;
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
      task_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (thread_id, account_id)
    );
    CREATE INDEX IF NOT EXISTS idx_email_thread_state_state ON email_thread_state(state);
  `);
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
  const existing = getEmailThreadState(threadId, accountId);
  if (existing) {
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
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
      if (value !== undefined) {
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
  created_by?: string;
  next_run: string;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO scheduled_jobs (name, schedule, prompt, target_source, target_external_id, enabled, created_by, next_run)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      job.name,
      job.schedule,
      job.prompt,
      job.target_source || "dashboard",
      job.target_external_id || "scheduler",
      job.enabled ?? 1,
      job.created_by || "user",
      job.next_run
    );
  return result.lastInsertRowid as number;
}

export function getScheduledJob(id: number): ScheduledJob | undefined {
  return getDb().prepare("SELECT * FROM scheduled_jobs WHERE id = ?").get(id) as ScheduledJob | undefined;
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
  const fields: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
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
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
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
