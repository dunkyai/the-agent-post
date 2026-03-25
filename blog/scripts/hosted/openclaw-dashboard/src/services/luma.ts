import { upsertIntegration } from "./db";
import { encrypt } from "./encryption";

const LUMA_API = "https://public-api.luma.com";

// Module state
interface LumaConfig {
  api_key: string;
  user_name?: string;
  calendar_name?: string;
}

let lumaConfig: LumaConfig | null = null;

// --- Connection test ---

export async function testLumaConnection(apiKey: string): Promise<{ user_name: string; calendar_name: string }> {
  const authHeaders = { "x-luma-api-key": apiKey, "Content-Type": "application/json" };

  const res = await fetch(`${LUMA_API}/v1/user/get-self`, { headers: authHeaders });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Invalid API key. Make sure you have a Luma Plus subscription and the key is correct.");
    }
    const body = await res.text();
    throw new Error(`Luma API error (${res.status}): ${body}`);
  }
  const data: any = await res.json();
  const user_name = data.name || data.email || "Connected";

  // Fetch calendar name tied to this API key
  let calendar_name = "";
  try {
    const calRes = await fetch(`${LUMA_API}/v1/calendar/get`, { headers: authHeaders });
    if (calRes.ok) {
      const calData: any = await calRes.json();
      calendar_name = calData.calendar?.name || "";
    }
  } catch {}

  return { user_name, calendar_name };
}

// --- Lifecycle ---

export function startLuma(config: LumaConfig): void {
  lumaConfig = config;
  console.log(`Luma connected${config.user_name ? ` (${config.user_name})` : ""}`);
}

export function stopLuma(): void {
  lumaConfig = null;
  console.log("Luma disconnected");
}

export function isLumaRunning(): boolean {
  return lumaConfig !== null;
}

export function getLumaUserName(): string | null {
  return lumaConfig?.user_name || null;
}

export function getLumaCalendarName(): string | null {
  return lumaConfig?.calendar_name || null;
}

// --- Auth helper ---

function headers(): Record<string, string> {
  if (!lumaConfig) throw new Error("Luma is not connected");
  return {
    "x-luma-api-key": lumaConfig.api_key,
    "Content-Type": "application/json",
  };
}

// --- API wrappers ---

export async function lumaListEvents(params?: {
  after?: string; before?: string; limit?: number; cursor?: string;
}): Promise<string> {
  if (!lumaConfig) return JSON.stringify({ error: "Luma is not connected" });

  try {
    const qp = new URLSearchParams();
    qp.set("after", params?.after || new Date().toISOString());
    qp.set("sort_direction", "asc");
    if (params?.before) qp.set("before", params.before);
    if (params?.limit) qp.set("pagination_limit", String(Math.min(params.limit, 50)));
    if (params?.cursor) qp.set("pagination_cursor", params.cursor);

    const res = await fetch(`${LUMA_API}/v1/calendar/list-events?${qp}`, { headers: headers() });
    if (!res.ok) {
      return JSON.stringify({ error: `Luma API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const events = (data.entries || []).map((e: any) => ({
      id: e.event?.api_id || e.event?.id,
      name: e.event?.name,
      start_at: e.event?.start_at,
      end_at: e.event?.end_at,
      timezone: e.event?.timezone,
      url: e.event?.url,
      visibility: e.event?.visibility,
      meeting_url: e.event?.meeting_url || null,
      description: e.event?.description ? e.event.description.slice(0, 500) : null,
    }));

    return JSON.stringify({
      events,
      count: events.length,
      has_more: data.has_more || false,
      next_cursor: data.next_cursor || null,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list events" });
  }
}

export async function lumaGetEvent(eventId: string): Promise<string> {
  if (!lumaConfig) return JSON.stringify({ error: "Luma is not connected" });

  try {
    const res = await fetch(`${LUMA_API}/v1/event/get?id=${encodeURIComponent(eventId)}`, {
      headers: headers(),
    });
    if (!res.ok) {
      return JSON.stringify({ error: `Luma API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const evt = data.event || data;
    const hosts = (data.hosts || []).map((h: any) => ({
      name: h.name,
      email: h.email,
    }));

    return JSON.stringify({
      id: evt.api_id || evt.id,
      name: evt.name,
      description: evt.description,
      start_at: evt.start_at,
      end_at: evt.end_at,
      timezone: evt.timezone,
      url: evt.url,
      visibility: evt.visibility,
      meeting_url: evt.meeting_url,
      cover_url: evt.cover_url,
      hosts,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get event" });
  }
}

export async function lumaCreateEvent(input: {
  name: string;
  start_at: string;
  end_at: string;
  timezone: string;
  description?: string;
  location?: string;
  meeting_url?: string;
  visibility?: string;
}): Promise<string> {
  if (!lumaConfig) return JSON.stringify({ error: "Luma is not connected" });

  try {
    const body: any = {
      name: input.name,
      start_at: input.start_at,
      end_at: input.end_at,
      timezone: input.timezone,
    };
    if (input.description) body.description_md = input.description;
    if (input.location) {
      body.geo_address_json = { address: input.location, full_address: input.location };
    }
    if (input.meeting_url) body.meeting_url = input.meeting_url;
    if (input.visibility) body.visibility = input.visibility;

    const res = await fetch(`${LUMA_API}/v1/event/create`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Luma API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const evt = data.event || data;
    return JSON.stringify({
      success: true,
      id: evt.api_id || evt.id,
      name: evt.name,
      start_at: evt.start_at,
      end_at: evt.end_at,
      timezone: evt.timezone,
      url: evt.url,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create event" });
  }
}

export async function lumaUpdateEvent(input: {
  event_id: string;
  name?: string;
  start_at?: string;
  end_at?: string;
  timezone?: string;
  description?: string;
  location?: string;
  meeting_url?: string;
  visibility?: string;
}): Promise<string> {
  if (!lumaConfig) return JSON.stringify({ error: "Luma is not connected" });

  try {
    const body: any = { id: input.event_id };
    if (input.name !== undefined) body.name = input.name;
    if (input.start_at !== undefined) body.start_at = input.start_at;
    if (input.end_at !== undefined) body.end_at = input.end_at;
    if (input.timezone !== undefined) body.timezone = input.timezone;
    if (input.description !== undefined) body.description_md = input.description;
    if (input.location !== undefined) {
      body.geo_address_json = input.location ? { address: input.location, full_address: input.location } : null;
    }
    if (input.meeting_url !== undefined) body.meeting_url = input.meeting_url;
    if (input.visibility !== undefined) body.visibility = input.visibility;

    console.log(`[luma] Updating event ${input.event_id}:`, JSON.stringify(body));
    const res = await fetch(`${LUMA_API}/v1/event/update`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[luma] Update failed (${res.status}):`, errBody);
      return JSON.stringify({ error: `Luma API error (${res.status}): ${errBody}` });
    }

    const data: any = await res.json();
    const evt = data.event || data;
    return JSON.stringify({
      success: true,
      id: evt.api_id || evt.id,
      name: evt.name,
      start_at: evt.start_at,
      end_at: evt.end_at,
      url: evt.url,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to update event" });
  }
}

export async function lumaGetGuests(
  eventId: string,
  params?: { approval_status?: string; limit?: number; cursor?: string }
): Promise<string> {
  if (!lumaConfig) return JSON.stringify({ error: "Luma is not connected" });

  try {
    const qp = new URLSearchParams({ event_id: eventId });
    if (params?.approval_status) qp.set("approval_status", params.approval_status);
    if (params?.limit) qp.set("pagination_limit", String(Math.min(params.limit, 100)));
    if (params?.cursor) qp.set("pagination_cursor", params.cursor);

    const res = await fetch(`${LUMA_API}/v1/event/get-guests?${qp}`, { headers: headers() });
    if (!res.ok) {
      return JSON.stringify({ error: `Luma API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const guests = (data.entries || []).map((e: any) => ({
      name: e.guest?.name,
      email: e.guest?.email,
      approval_status: e.guest?.approval_status,
      registered_at: e.guest?.registered_at,
    }));

    return JSON.stringify({
      event_id: eventId,
      guests,
      count: guests.length,
      has_more: data.has_more || false,
      next_cursor: data.next_cursor || null,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get guests" });
  }
}

export async function lumaAddGuests(
  eventId: string,
  guests: { email: string; name?: string }[]
): Promise<string> {
  if (!lumaConfig) return JSON.stringify({ error: "Luma is not connected" });

  try {
    const res = await fetch(`${LUMA_API}/v1/event/add-guests`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        event_id: eventId,
        guests: guests.map((g) => ({
          email: g.email,
          name: g.name || undefined,
        })),
      }),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Luma API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    return JSON.stringify({
      success: true,
      event_id: eventId,
      added: guests.length,
      guests_added: guests.map((g) => g.email),
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to add guests" });
  }
}

export async function lumaSendInvites(eventId: string): Promise<string> {
  if (!lumaConfig) return JSON.stringify({ error: "Luma is not connected" });

  try {
    const res = await fetch(`${LUMA_API}/v1/event/send-invites`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ event_id: eventId }),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Luma API error (${res.status}): ${await res.text()}` });
    }

    return JSON.stringify({ success: true, event_id: eventId, message: "Invitations sent" });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to send invites" });
  }
}
