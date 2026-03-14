import Database from "better-sqlite3";
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
  )
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
