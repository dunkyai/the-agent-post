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
