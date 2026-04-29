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

  CREATE TABLE IF NOT EXISTS slack_user_instances (
    team_id TEXT NOT NULL,
    slack_user_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (team_id, slack_user_id),
    FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
  );
`);

// Migrations
try { db.exec("ALTER TABLE instances ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'active'"); } catch {}
try { db.exec("ALTER TABLE instances ADD COLUMN plan TEXT NOT NULL DEFAULT 'standard'"); } catch {}
try { db.exec("ALTER TABLE instances ADD COLUMN message_limit INTEGER NOT NULL DEFAULT 250"); } catch {}

function rowToInstance(row: Record<string, unknown>): Instance {
  return {
    id: row.id as string,
    email: row.email as string,
    subdomain: row.subdomain as string,
    port: row.port as number,
    status: row.status as Instance["status"],
    stripeCustomerId: row.stripe_customer_id as string,
    stripeSubscriptionId: row.stripe_subscription_id as string,
    subscriptionStatus: (row.subscription_status as Instance["subscriptionStatus"]) || "active",
    gatewayToken: row.gateway_token as string,
    containerId: (row.container_id as string) || null,
    plan: (row.plan as Instance["plan"]) || "standard",
    messageLimit: (row.message_limit as number) || 250,
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

export function getInstancesByEmail(email: string): Instance[] {
  const rows = db
    .prepare("SELECT * FROM instances WHERE LOWER(email) = LOWER(?) AND status = 'running' ORDER BY created_at DESC")
    .all(email) as Record<string, unknown>[];
  return rows.map(rowToInstance);
}

export function listInstances(): Instance[] {
  const rows = db.prepare("SELECT * FROM instances WHERE status != 'deleted' ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map(rowToInstance);
}

export function updateInstance(id: string, updates: Partial<Pick<Instance, "status" | "containerId" | "subscriptionStatus" | "plan" | "messageLimit">>): Instance | null {
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
  if (updates.subscriptionStatus !== undefined) {
    sets.push("subscription_status = ?");
    values.push(updates.subscriptionStatus);
  }
  if (updates.plan !== undefined) {
    sets.push("plan = ?");
    values.push(updates.plan);
  }
  if (updates.messageLimit !== undefined) {
    sets.push("message_limit = ?");
    values.push(updates.messageLimit);
  }

  values.push(id);
  db.prepare(`UPDATE instances SET ${sets.join(", ")} WHERE id = ?`).run(...values);

  return getInstance(id);
}

export function getBillingSuspendable(): Instance[] {
  const rows = db.prepare(
    "SELECT * FROM instances WHERE status = 'running' AND subscription_status != 'active'"
  ).all() as Record<string, unknown>[];
  return rows.map(rowToInstance);
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
  // Only insert if no existing installation for this team (first installer keeps the row)
  // The bot token is tied to the app, not the user, so the first install works for all instances
  const existing = db.prepare("SELECT team_id FROM slack_installations WHERE team_id = ?").get(installation.teamId);
  if (!existing) {
    db.prepare(
      `INSERT INTO slack_installations (team_id, instance_id, bot_user_id, team_name)
       VALUES (?, ?, ?, ?)`
    ).run(
      installation.teamId,
      installation.instanceId,
      installation.botUserId,
      installation.teamName
    );
  }
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
  db.prepare("DELETE FROM slack_user_instances WHERE instance_id = ?").run(instanceId);
}

// --- Slack user → instance mapping (multi-tenant) ---

export function upsertSlackUserInstance(teamId: string, slackUserId: string, instanceId: string): void {
  db.prepare(
    `INSERT INTO slack_user_instances (team_id, slack_user_id, instance_id)
     VALUES (?, ?, ?)
     ON CONFLICT(team_id, slack_user_id) DO UPDATE SET instance_id = ?, created_at = datetime('now')`
  ).run(teamId, slackUserId, instanceId, instanceId);
}

export function getSlackUserInstance(teamId: string, slackUserId: string): string | null {
  const row = db.prepare(
    "SELECT instance_id FROM slack_user_instances WHERE team_id = ? AND slack_user_id = ?"
  ).get(teamId, slackUserId) as { instance_id: string } | undefined;
  return row ? row.instance_id : null;
}

// --- Magic Link Tokens ---

export function createMagicLinkToken(instanceId: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
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
