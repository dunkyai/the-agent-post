// One (withone.ai / Pica) — Hybrid integration layer
// Provides 250+ platform connections through a single API.
// Native integrations take priority; One handles the long tail.

import { AuthKitToken } from "@picahq/authkit-token";

const PICA_API = "https://api.picaos.com";

interface OneConnection {
  connection_key: string;
  platform: string;
  display_name?: string;
}

interface OneConfig {
  connections: OneConnection[];
}

let oneConfig: OneConfig | null = null;

// --- Lifecycle ---

export function startOne(config: OneConfig): void {
  oneConfig = config;
  const platforms = config.connections.map((c) => c.platform).join(", ");
  console.log(`One started (${config.connections.length} connection(s): ${platforms})`);
}

export function stopOne(): void {
  oneConfig = null;
  console.log("One stopped");
}

export function isOneRunning(): boolean {
  return oneConfig !== null && oneConfig.connections.length > 0;
}

export function getOneConnections(): OneConnection[] {
  return oneConfig?.connections || [];
}

export function getOneConnectionPlatforms(): string[] {
  return (oneConfig?.connections || []).map((c) => c.platform);
}

function getSecret(): string {
  const secret = process.env.ONE_SECRET;
  if (!secret) throw new Error("ONE_SECRET not configured");
  return secret;
}

function getIdentity(): string {
  return process.env.INSTANCE_ID || "default";
}

function truncate(text: string, maxLen = 10000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n... [truncated, ${text.length - maxLen} chars omitted]`;
}

// --- API Functions ---

export async function getAuthKitData(): Promise<any> {
  try {
    const authkit = new AuthKitToken(getSecret());
    const result = await authkit.create({
      identity: getIdentity(),
      identityType: "user",
    });
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to get AuthKit data" };
  }
}

export async function fetchConnections(): Promise<OneConnection[]> {
  try {
    // Use AuthKitToken to get connections (calls POST /v1/authkit)
    const authkit = new AuthKitToken(getSecret());
    const result = await authkit.create({
      identity: getIdentity(),
      identityType: "user",
    });

    const connections: OneConnection[] = [];
    for (const conn of result?.rows || []) {
      connections.push({
        connection_key: conn.key || conn.connectionKey || conn.connection_key,
        platform: conn.platform || conn.provider || "unknown",
        display_name: conn.name || conn.displayName || conn.platform || conn.provider,
      });
    }
    return connections;
  } catch (err) {
    console.error("[one] Failed to fetch connections:", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function listConnections(): Promise<string> {
  const connections = getOneConnections();
  if (connections.length === 0) {
    return JSON.stringify({ connections: [], message: "No platforms connected through One. The user can connect platforms from the Integrations page." });
  }
  return JSON.stringify({
    connections: connections.map((c) => ({ platform: c.platform, display_name: c.display_name })),
  });
}

export async function searchActions(platform: string, query: string): Promise<string> {
  try {
    const url = `${PICA_API}/v1/available-actions/search/${encodeURIComponent(platform)}?query=${encodeURIComponent(query)}&executeAgent=true`;
    const res = await fetch(url, {
      headers: { "X-Pica-Secret": getSecret() },
    });

    if (!res.ok) {
      const body = await res.text();
      return JSON.stringify({ error: `Action search failed (${res.status}): ${body}` });
    }

    const data: any = await res.json();
    return truncate(JSON.stringify(data));
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Action search failed" });
  }
}

export async function getActionKnowledge(actionId: string): Promise<string> {
  try {
    const res = await fetch(`${PICA_API}/v1/knowledge?_id=${encodeURIComponent(actionId)}`, {
      headers: { "X-Pica-Secret": getSecret() },
    });

    if (!res.ok) {
      const body = await res.text();
      return JSON.stringify({ error: `Knowledge lookup failed (${res.status}): ${body}` });
    }

    const data: any = await res.json();
    return truncate(JSON.stringify(data));
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Knowledge lookup failed" });
  }
}

export async function executeAction(
  method: string,
  path: string,
  connectionKey: string,
  actionId: string,
  body?: any
): Promise<string> {
  try {
    const url = `${PICA_API}/v1/passthrough/${path.replace(/^\//, "")}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Pica-Secret": getSecret(),
      "x-pica-connection-key": connectionKey,
      "x-pica-action-id": actionId,
    };

    const fetchOpts: RequestInit = { method: method.toUpperCase(), headers };
    if (body && method.toUpperCase() !== "GET") {
      fetchOpts.body = JSON.stringify(body);
    }

    const res = await fetch(url, fetchOpts);

    if (!res.ok) {
      const respBody = await res.text();
      return JSON.stringify({ error: `Action failed (${res.status}): ${respBody}` });
    }

    const data: any = await res.json().catch(() => ({ success: true }));
    return truncate(JSON.stringify(data));
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Action execution failed" });
  }
}

export function getConnectionKeyForPlatform(platform: string): string | null {
  if (!oneConfig) return null;
  const conn = oneConfig.connections.find(
    (c) => c.platform.toLowerCase() === platform.toLowerCase()
  );
  return conn?.connection_key || null;
}
