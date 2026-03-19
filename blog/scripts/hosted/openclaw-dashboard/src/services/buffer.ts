import crypto from "crypto";
import { upsertIntegration } from "./db";
import { encrypt } from "./encryption";

const BUFFER_API = "https://api.bufferapp.com/1";

// Module state
interface BufferConfig {
  access_token: string;
}

let bufferConfig: BufferConfig | null = null;

// --- OAuth URL ---

export function buildBufferOAuthUrl(): string {
  const clientId = process.env.BUFFER_CLIENT_ID;
  const instanceId = process.env.INSTANCE_ID;

  if (!clientId) throw new Error("BUFFER_CLIENT_ID not configured");
  if (!instanceId) throw new Error("INSTANCE_ID not configured");

  const statePayload = {
    instance_id: instanceId,
    hmac: crypto
      .createHmac("sha256", process.env.GATEWAY_TOKEN!)
      .update(instanceId)
      .digest("hex"),
  };
  const state = Buffer.from(JSON.stringify(statePayload)).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "https://api.agents.theagentpost.co/oauth/buffer/callback",
    response_type: "code",
    state,
  });

  return `https://bufferapp.com/oauth2/authorize?${params.toString()}`;
}

// --- Lifecycle ---

export function startBuffer(config: BufferConfig): void {
  bufferConfig = config;
  console.log("Buffer connected");
}

export function stopBuffer(): void {
  bufferConfig = null;
  console.log("Buffer disconnected");
}

export function isBufferRunning(): boolean {
  return bufferConfig !== null;
}

// --- API helpers ---

function authHeaders(): Record<string, string> {
  if (!bufferConfig) throw new Error("Buffer is not connected");
  return {
    Authorization: `Bearer ${bufferConfig.access_token}`,
    "Content-Type": "application/json",
  };
}

// --- API wrappers ---

export async function bufferListProfiles(): Promise<string> {
  if (!bufferConfig) return JSON.stringify({ error: "Buffer is not connected" });

  try {
    const res = await fetch(`${BUFFER_API}/profiles.json`, {
      headers: authHeaders(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Buffer API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const profiles = (Array.isArray(data) ? data : []).map((p: any) => ({
      id: p.id,
      service: p.service,
      service_username: p.service_username,
      formatted_username: p.formatted_username,
      avatar: p.avatar_https,
      counts: {
        pending: p.counts?.pending,
        sent: p.counts?.sent,
      },
    }));

    return JSON.stringify({ profiles, count: profiles.length });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list profiles" });
  }
}

export async function bufferCreatePost(
  profileIds: string[],
  text: string,
  options?: { now?: boolean; scheduled_at?: string; media?: { link?: string; photo?: string } }
): Promise<string> {
  if (!bufferConfig) return JSON.stringify({ error: "Buffer is not connected" });

  try {
    const body: any = {
      text,
      profile_ids: profileIds,
    };

    if (options?.now) {
      body.now = true;
    } else if (options?.scheduled_at) {
      body.scheduled_at = options.scheduled_at;
    }

    if (options?.media) {
      body.media = options.media;
    }

    const res = await fetch(`${BUFFER_API}/updates/create.json`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Buffer API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    if (!data.success) {
      return JSON.stringify({ error: data.message || "Buffer rejected the post" });
    }

    const update = data.updates?.[0] || data.update || {};
    return JSON.stringify({
      success: true,
      id: update.id,
      status: update.status,
      text: update.text,
      scheduled_at: update.scheduled_at,
      profile_ids: profileIds,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create post" });
  }
}

export async function bufferGetPendingPosts(profileId: string): Promise<string> {
  if (!bufferConfig) return JSON.stringify({ error: "Buffer is not connected" });

  try {
    const res = await fetch(`${BUFFER_API}/profiles/${encodeURIComponent(profileId)}/updates/pending.json`, {
      headers: authHeaders(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Buffer API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const updates = (data.updates || []).map((u: any) => ({
      id: u.id,
      text: u.text,
      status: u.status,
      scheduled_at: u.scheduled_at,
      created_at: u.created_at,
    }));

    return JSON.stringify({ profile_id: profileId, updates, count: updates.length });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get pending posts" });
  }
}

export async function bufferGetSentPosts(profileId: string): Promise<string> {
  if (!bufferConfig) return JSON.stringify({ error: "Buffer is not connected" });

  try {
    const res = await fetch(`${BUFFER_API}/profiles/${encodeURIComponent(profileId)}/updates/sent.json`, {
      headers: authHeaders(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Buffer API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const updates = (data.updates || []).map((u: any) => ({
      id: u.id,
      text: u.text,
      status: u.status,
      sent_at: u.sent_at,
      created_at: u.created_at,
      statistics: u.statistics,
    }));

    return JSON.stringify({ profile_id: profileId, updates, count: updates.length });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get sent posts" });
  }
}
