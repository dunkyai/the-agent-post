// One (withone.ai) — Hybrid integration layer
// Provides 250+ platform connections through a single API.
// Native integrations take priority; One handles the long tail.

const ONE_API = "https://api.withone.ai";

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

export async function createLinkToken(): Promise<string> {
  try {
    const res = await fetch(`${ONE_API}/v1/authkit/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-one-secret": getSecret(),
      },
      body: JSON.stringify({
        identity: getIdentity(),
        identityType: "user",
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return JSON.stringify({ error: `Failed to create link token (${res.status}): ${body}` });
    }

    const data: any = await res.json();
    return JSON.stringify({ token: data.token || data.linkToken });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create link token" });
  }
}

export async function fetchConnections(): Promise<OneConnection[]> {
  try {
    const res = await fetch(
      `${ONE_API}/v1/vault/connections?identity=${encodeURIComponent(getIdentity())}&identityType=user`,
      {
        headers: { "x-one-secret": getSecret() },
      }
    );

    if (!res.ok) {
      console.error(`[one] Failed to fetch connections (${res.status})`);
      return [];
    }

    const data: any = await res.json();
    const connections: OneConnection[] = [];
    for (const conn of data.connections || data || []) {
      connections.push({
        connection_key: conn.connectionKey || conn.connection_key || conn.key,
        platform: conn.platform || conn.provider || "unknown",
        display_name: conn.displayName || conn.display_name || conn.platform || conn.provider,
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
    const url = `${ONE_API}/v1/available-actions/search/${encodeURIComponent(platform)}?query=${encodeURIComponent(query)}&executeAgent=true`;
    const res = await fetch(url, {
      headers: { "x-one-secret": getSecret() },
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
    const res = await fetch(`${ONE_API}/v1/knowledge?_id=${encodeURIComponent(actionId)}`, {
      headers: { "x-one-secret": getSecret() },
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
    const url = `${ONE_API}/v1/passthrough/${path.replace(/^\//, "")}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-one-secret": getSecret(),
      "x-one-connection-key": connectionKey,
      "x-one-action-id": actionId,
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
