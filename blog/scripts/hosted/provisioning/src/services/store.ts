import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import type { Instance } from "../types";

const DB_PATH = process.env.DB_PATH || "/opt/agentpost/data/instances.db";

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS instances (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    subdomain TEXT UNIQUE NOT NULL,
    port INTEGER UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'provisioning',
    stripe_customer_id TEXT NOT NULL,
    stripe_subscription_id TEXT UNIQUE NOT NULL,
    gateway_token TEXT NOT NULL,
    container_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS magic_link_tokens (
    token TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    session_code TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS slack_installations (
    team_id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    bot_user_id TEXT NOT NULL,
    team_name TEXT,
    installed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
  );
`);

function rowToInstance(row: Record<string, unknown>): Instance {
  return {
    id: row.id as string,
    email: row.email as string,
    subdomain: row.subdomain as string,
    port: row.port as number,
    status: row.status as Instance["status"],
    stripeCustomerId: row.stripe_customer_id as string,
    stripeSubscriptionId: row.stripe_subscription_id as string,
    gatewayToken: row.gateway_token as string,
    containerId: (row.container_id as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function createInstance(instance: Omit<Instance, "createdAt" | "updatedAt">): Instance {
  const stmt = db.prepare(`
    INSERT INTO instances (id, email, subdomain, port, status, stripe_customer_id, stripe_subscription_id, gateway_token, container_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    instance.id,
    instance.email,
    instance.subdomain,
    instance.port,
    instance.status,
    instance.stripeCustomerId,
    instance.stripeSubscriptionId,
    instance.gatewayToken,
    instance.containerId
  );

  return getInstance(instance.id)!;
}

export function getInstance(id: string): Instance | null {
  const row = db.prepare("SELECT * FROM instances WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToInstance(row) : null;
}

export function getInstanceBySubscription(subscriptionId: string): Instance | null {
  const row = db
    .prepare("SELECT * FROM instances WHERE stripe_subscription_id = ?")
    .get(subscriptionId) as Record<string, unknown> | undefined;
  return row ? rowToInstance(row) : null;
}

export function listInstances(): Instance[] {
  const rows = db.prepare("SELECT * FROM instances WHERE status != 'deleted' ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map(rowToInstance);
}

export function updateInstance(id: string, updates: Partial<Pick<Instance, "status" | "containerId">>): Instance | null {
  const sets: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.containerId !== undefined) {
    sets.push("container_id = ?");
    values.push(updates.containerId);
  }

  values.push(id);
  db.prepare(`UPDATE instances SET ${sets.join(", ")} WHERE id = ?`).run(...values);

  return getInstance(id);
}

export function deleteInstance(id: string): void {
  updateInstance(id, { status: "deleted" });
}

// --- Slack installations ---

export interface SlackInstallation {
  teamId: string;
  instanceId: string;
  botUserId: string;
  teamName: string | null;
  installedAt: string;
}

export function upsertSlackInstallation(installation: {
  teamId: string;
  instanceId: string;
  botUserId: string;
  teamName: string | null;
}): void {
  // Remove any prior installation for this instance (workspace switch)
  db.prepare("DELETE FROM slack_installations WHERE instance_id = ?").run(installation.instanceId);
  db.prepare(
    `INSERT INTO slack_installations (team_id, instance_id, bot_user_id, team_name)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(team_id) DO UPDATE SET instance_id = ?, bot_user_id = ?, team_name = ?, installed_at = datetime('now')`
  ).run(
    installation.teamId,
    installation.instanceId,
    installation.botUserId,
    installation.teamName,
    installation.instanceId,
    installation.botUserId,
    installation.teamName
  );
}

export function getSlackInstallationByTeam(teamId: string): SlackInstallation | null {
  const row = db.prepare("SELECT * FROM slack_installations WHERE team_id = ?").get(teamId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    teamId: row.team_id as string,
    instanceId: row.instance_id as string,
    botUserId: row.bot_user_id as string,
    teamName: (row.team_name as string) || null,
    installedAt: row.installed_at as string,
  };
}

export function deleteSlackInstallationsByInstance(instanceId: string): void {
  db.prepare("DELETE FROM slack_installations WHERE instance_id = ?").run(instanceId);
}

// --- Magic Link Tokens ---

export function createMagicLinkToken(instanceId: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes
  db.prepare(
    "INSERT INTO magic_link_tokens (token, instance_id, expires_at) VALUES (?, ?, ?)"
  ).run(token, instanceId, expiresAt);
  return token;
}

export function consumeMagicLinkToken(token: string): { instanceId: string; sessionCode: string } | null {
  const row = db.prepare(
    "SELECT * FROM magic_link_tokens WHERE token = ?"
  ).get(token) as Record<string, unknown> | undefined;

  if (!row) return null;
  if (row.used === 1) return null;
  if (new Date(row.expires_at as string) < new Date()) return null;

  const sessionCode = crypto.randomBytes(32).toString("hex");
  db.prepare(
    "UPDATE magic_link_tokens SET used = 1, session_code = ? WHERE token = ?"
  ).run(sessionCode, token);

  return { instanceId: row.instance_id as string, sessionCode };
}

export function verifySessionCode(instanceId: string, code: string): boolean {
  const row = db.prepare(
    "SELECT * FROM magic_link_tokens WHERE instance_id = ? AND session_code = ? AND used = 1"
  ).get(instanceId, code) as Record<string, unknown> | undefined;

  if (!row) return false;

  // Single-use: delete after verification
  db.prepare("DELETE FROM magic_link_tokens WHERE token = ?").run(row.token);
  return true;
}

export function cleanExpiredTokens(): number {
  const result = db.prepare(
    "DELETE FROM magic_link_tokens WHERE expires_at < datetime('now') OR (used = 1 AND session_code IS NULL)"
  ).run();
  return result.changes;
}

export function getRecentMagicLinkForInstance(instanceId: string): { created_at: string } | null {
  return db.prepare(
    "SELECT created_at FROM magic_link_tokens WHERE instance_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(instanceId) as { created_at: string } | null;
}

export function countRecentMagicLinksForInstance(instanceId: string, windowMs: number): number {
  const since = new Date(Date.now() - windowMs).toISOString();
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM magic_link_tokens WHERE instance_id = ? AND created_at > ?"
  ).get(instanceId, since) as { count: number };
  return row.count;
}
