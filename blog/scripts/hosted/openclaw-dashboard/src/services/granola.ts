import crypto from "crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { upsertIntegration } from "./db";
import { encrypt } from "./encryption";

const MCP_ENDPOINT = "https://mcp.granola.ai/mcp";
const AUTH_SERVER = "https://mcp-auth.granola.ai";

// Module state
interface GranolaConfig {
  access_token: string;
  refresh_token?: string;
  client_id: string;
  client_secret?: string;
  token_expiry?: string;
}

let granolaConfig: GranolaConfig | null = null;
let mcpClient: Client | null = null;

// --- OAuth URL (DCR + PKCE) ---

export async function buildGranolaOAuthUrl(): Promise<string> {
  const instanceId = process.env.INSTANCE_ID;
  if (!instanceId) throw new Error("INSTANCE_ID not configured");

  const callbackUrl = "https://api.agents.theagentpost.co/oauth/granola/callback";

  // Step 1: Dynamic Client Registration
  const dcrRes = await fetch(`${AUTH_SERVER}/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "OpenClaw Agent",
      redirect_uris: [callbackUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });

  if (!dcrRes.ok) {
    const body = await dcrRes.text();
    throw new Error(`Granola DCR failed (${dcrRes.status}): ${body}`);
  }

  const dcrData: any = await dcrRes.json();
  const clientId = dcrData.client_id;
  const clientSecret = dcrData.client_secret;

  // Step 2: PKCE
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  // State includes instance info, HMAC, PKCE verifier, and DCR client info
  const statePayload = {
    instance_id: instanceId,
    hmac: crypto
      .createHmac("sha256", process.env.GATEWAY_TOKEN!)
      .update(instanceId)
      .digest("hex"),
    code_verifier: codeVerifier,
    client_id: clientId,
    client_secret: clientSecret || undefined,
  };
  const state = Buffer.from(JSON.stringify(statePayload)).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "openid email offline_access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `${AUTH_SERVER}/oauth2/authorize?${params.toString()}`;
}

// --- Lifecycle ---

export function startGranola(config: GranolaConfig): void {
  granolaConfig = config;
  mcpClient = null; // Will be created lazily on first tool call
  console.log("Granola connected");
}

export function stopGranola(): void {
  if (mcpClient) {
    try { mcpClient.close(); } catch {}
  }
  mcpClient = null;
  granolaConfig = null;
  console.log("Granola disconnected");
}

export function isGranolaRunning(): boolean {
  return granolaConfig !== null;
}

// --- MCP Client (lazy connection) ---

async function getClient(): Promise<Client> {
  if (!granolaConfig) throw new Error("Granola is not connected");

  if (mcpClient) return mcpClient;

  // Check if token needs refresh
  if (granolaConfig.token_expiry && granolaConfig.refresh_token) {
    const expiry = new Date(granolaConfig.token_expiry);
    if (expiry.getTime() - Date.now() < 5 * 60 * 1000) {
      await refreshAccessToken();
    }
  }

  const client = new Client(
    { name: "openclaw-agent", version: "1.0.0" },
    { capabilities: {} }
  );

  const transport = new StreamableHTTPClientTransport(
    new URL(MCP_ENDPOINT),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${granolaConfig.access_token}`,
        },
      },
    }
  );

  await client.connect(transport);
  mcpClient = client;
  return client;
}

async function refreshAccessToken(): Promise<void> {
  if (!granolaConfig || !granolaConfig.refresh_token) return;

  try {
    const params: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: granolaConfig.refresh_token,
      client_id: granolaConfig.client_id,
    };
    if (granolaConfig.client_secret) {
      params.client_secret = granolaConfig.client_secret;
    }

    const res = await fetch(`${AUTH_SERVER}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });

    if (!res.ok) {
      console.error(`Granola token refresh failed: ${await res.text()}`);
      return;
    }

    const data: any = await res.json();
    granolaConfig.access_token = data.access_token;
    if (data.refresh_token) granolaConfig.refresh_token = data.refresh_token;
    if (data.expires_in) {
      granolaConfig.token_expiry = new Date(Date.now() + data.expires_in * 1000).toISOString();
    }

    // Persist updated tokens
    const config = encrypt(JSON.stringify(granolaConfig));
    upsertIntegration("granola", config, "connected");

    // Force new MCP client on next call
    if (mcpClient) {
      try { mcpClient.close(); } catch {}
      mcpClient = null;
    }

    console.log("Granola token refreshed");
  } catch (err) {
    console.error("Granola refresh error:", err instanceof Error ? err.message : err);
  }
}

// --- Tool Wrappers ---

export async function granolaListMeetings(params?: {
  created_after?: string;
  created_before?: string;
}): Promise<string> {
  if (!granolaConfig) return JSON.stringify({ error: "Granola is not connected" });

  try {
    const client = await getClient();
    const result = await client.callTool({
      name: "list_meetings",
      arguments: params || {},
    });
    const text = (result.content as any[])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    return text || JSON.stringify(result.content);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list meetings" });
  }
}

export async function granolaGetMeetings(params: {
  query?: string;
  meeting_ids?: string[];
}): Promise<string> {
  if (!granolaConfig) return JSON.stringify({ error: "Granola is not connected" });

  try {
    const client = await getClient();
    const result = await client.callTool({
      name: "get_meetings",
      arguments: params,
    });
    const text = (result.content as any[])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    return text || JSON.stringify(result.content);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get meetings" });
  }
}

export async function granolaGetTranscript(meetingId: string): Promise<string> {
  if (!granolaConfig) return JSON.stringify({ error: "Granola is not connected" });

  try {
    const client = await getClient();
    const result = await client.callTool({
      name: "get_meeting_transcript",
      arguments: { meeting_id: meetingId },
    });
    const text = (result.content as any[])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    return text || JSON.stringify(result.content);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get transcript" });
  }
}

export async function granolaQueryMeetings(query: string): Promise<string> {
  if (!granolaConfig) return JSON.stringify({ error: "Granola is not connected" });

  try {
    const client = await getClient();
    const result = await client.callTool({
      name: "query_granola_meetings",
      arguments: { query },
    });
    const text = (result.content as any[])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    return text || JSON.stringify(result.content);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to query meetings" });
  }
}

export async function granolaListFolders(): Promise<string> {
  if (!granolaConfig) return JSON.stringify({ error: "Granola is not connected" });

  try {
    const client = await getClient();
    const result = await client.callTool({
      name: "list_meeting_folders",
      arguments: {},
    });
    const text = (result.content as any[])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    return text || JSON.stringify(result.content);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list folders" });
  }
}
