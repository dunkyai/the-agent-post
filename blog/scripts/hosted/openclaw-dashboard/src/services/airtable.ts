import crypto from "crypto";
import { upsertIntegration } from "./db";
import { encrypt, encryptOAuthState } from "./encryption";

const AIRTABLE_API = "https://api.airtable.com";

// Module state
interface AirtableConfig {
  access_token: string;
  refresh_token: string;
  token_expiry: string;
}

let airtableConfig: AirtableConfig | null = null;

// --- OAuth URL ---

export function buildAirtableOAuthUrl(): string {
  const clientId = process.env.AIRTABLE_CLIENT_ID;
  const instanceId = process.env.INSTANCE_ID;

  if (!clientId) throw new Error("AIRTABLE_CLIENT_ID not configured");
  if (!instanceId) throw new Error("INSTANCE_ID not configured");

  // PKCE: generate code_verifier and code_challenge
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  const statePayload = {
    instance_id: instanceId,
    hmac: crypto
      .createHmac("sha256", process.env.GATEWAY_TOKEN!)
      .update(instanceId)
      .digest("hex"),
    code_verifier: codeVerifier,
  };
  const state = encryptOAuthState(statePayload);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "https://api.dunky.ai/oauth/airtable/callback",
    response_type: "code",
    scope: "data.records:read schema.bases:read",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `https://airtable.com/oauth2/v1/authorize?${params.toString()}`;
}

// --- Lifecycle ---

export function startAirtable(config: AirtableConfig): void {
  airtableConfig = config;
  console.log("Airtable connected");
}

export function stopAirtable(): void {
  airtableConfig = null;
  console.log("Airtable disconnected");
}

export function isAirtableRunning(): boolean {
  return airtableConfig !== null;
}

// --- Token management ---

async function getValidAccessToken(): Promise<string> {
  if (!airtableConfig) throw new Error("Airtable is not connected");

  const expiry = new Date(airtableConfig.token_expiry).getTime();
  const fiveMinutes = 5 * 60 * 1000;

  if (Date.now() < expiry - fiveMinutes) {
    return airtableConfig.access_token;
  }

  // Refresh
  return refreshAccessToken();
}

async function refreshAccessToken(): Promise<string> {
  if (!airtableConfig) throw new Error("Airtable is not connected");

  const clientId = process.env.AIRTABLE_CLIENT_ID;
  const clientSecret = process.env.AIRTABLE_CLIENT_SECRET;
  if (!clientId) throw new Error("AIRTABLE_CLIENT_ID not configured");
  if (!clientSecret) throw new Error("AIRTABLE_CLIENT_SECRET not configured");

  const res = await fetch("https://airtable.com/oauth2/v1/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: airtableConfig.refresh_token,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable token refresh failed (${res.status}): ${body}`);
  }

  const data: any = await res.json();

  // Update in-memory config
  airtableConfig.access_token = data.access_token;
  airtableConfig.token_expiry = new Date(Date.now() + data.expires_in * 1000).toISOString();
  if (data.refresh_token) {
    airtableConfig.refresh_token = data.refresh_token;
  }

  // Persist updated tokens to DB
  const configData = {
    access_token: airtableConfig.access_token,
    refresh_token: airtableConfig.refresh_token,
    token_expiry: airtableConfig.token_expiry,
  };
  upsertIntegration("airtable", encrypt(JSON.stringify(configData)), "connected");

  console.log("Airtable token refreshed");
  return airtableConfig.access_token;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getValidAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// --- API wrappers ---

export async function airtableListBases(): Promise<string> {
  if (!airtableConfig) return JSON.stringify({ error: "Airtable is not connected" });

  try {
    const res = await fetch(`${AIRTABLE_API}/v0/meta/bases`, {
      headers: await authHeaders(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Airtable API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const bases = (data.bases || []).map((b: any) => ({
      id: b.id,
      name: b.name,
      permissionLevel: b.permissionLevel,
    }));

    return JSON.stringify({ bases, count: bases.length });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list bases" });
  }
}

export async function airtableListTables(baseId: string): Promise<string> {
  if (!airtableConfig) return JSON.stringify({ error: "Airtable is not connected" });

  try {
    const res = await fetch(`${AIRTABLE_API}/v0/meta/bases/${encodeURIComponent(baseId)}/tables`, {
      headers: await authHeaders(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Airtable API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const tables = (data.tables || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      fields: (t.fields || []).map((f: any) => ({ id: f.id, name: f.name, type: f.type })),
    }));

    return JSON.stringify({ base_id: baseId, tables, count: tables.length });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list tables" });
  }
}

export async function airtableListRecords(
  baseId: string,
  tableIdOrName: string,
  options?: { view?: string; filterByFormula?: string; sort?: { field: string; direction?: string }[]; maxRecords?: number }
): Promise<string> {
  if (!airtableConfig) return JSON.stringify({ error: "Airtable is not connected" });

  try {
    const params = new URLSearchParams();
    if (options?.view) params.set("view", options.view);
    if (options?.filterByFormula) params.set("filterByFormula", options.filterByFormula);
    // Default to 25 records to avoid context overflow; user can request more explicitly
    params.set("maxRecords", String(options?.maxRecords || 25));
    if (options?.sort) {
      options.sort.forEach((s, i) => {
        params.set(`sort[${i}][field]`, s.field);
        if (s.direction) params.set(`sort[${i}][direction]`, s.direction);
      });
    }

    const res = await fetch(
      `${AIRTABLE_API}/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableIdOrName)}?${params}`,
      { headers: await authHeaders() }
    );

    if (!res.ok) {
      return JSON.stringify({ error: `Airtable API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const records = (data.records || []).map((r: any) => ({
      id: r.id,
      fields: r.fields,
      createdTime: r.createdTime,
    }));

    const result = JSON.stringify({ base_id: baseId, table: tableIdOrName, records, count: records.length });
    // Truncate if response is too large for AI context (>100KB)
    if (result.length > 100000) {
      const truncatedRecords = records.slice(0, 10);
      return JSON.stringify({
        base_id: baseId,
        table: tableIdOrName,
        records: truncatedRecords,
        count: truncatedRecords.length,
        total_available: records.length,
        truncated: true,
        note: `Response was too large (${records.length} records). Showing first 10. Use filterByFormula to narrow your query.`,
      });
    }
    return result;
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list records" });
  }
}

export async function airtableCreateRecords(
  baseId: string,
  tableIdOrName: string,
  records: { fields: Record<string, any> }[]
): Promise<string> {
  if (!airtableConfig) return JSON.stringify({ error: "Airtable is not connected" });

  try {
    const res = await fetch(
      `${AIRTABLE_API}/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableIdOrName)}`,
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ records }),
      }
    );

    if (!res.ok) {
      return JSON.stringify({ error: `Airtable API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    return JSON.stringify({ success: true, created: (data.records || []).length, records: data.records });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create records" });
  }
}

export async function airtableUpdateRecords(
  baseId: string,
  tableIdOrName: string,
  records: { id: string; fields: Record<string, any> }[]
): Promise<string> {
  if (!airtableConfig) return JSON.stringify({ error: "Airtable is not connected" });

  try {
    const res = await fetch(
      `${AIRTABLE_API}/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableIdOrName)}`,
      {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ records }),
      }
    );

    if (!res.ok) {
      return JSON.stringify({ error: `Airtable API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    return JSON.stringify({ success: true, updated: (data.records || []).length, records: data.records });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to update records" });
  }
}
