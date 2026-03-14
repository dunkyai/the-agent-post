import crypto from "crypto";
import { getIntegration, upsertIntegration } from "./db";
import { encrypt, decrypt } from "./encryption";

// --- Types ---

export interface GoogleConfig {
  access_token: string;
  refresh_token: string;
  token_expiry: string;
  services: string[];
  google_email: string;
}

// --- Scope mapping ---

const SCOPE_MAP: Record<string, string[]> = {
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.labels",
  ],
  gmail_send: [
    "https://www.googleapis.com/auth/gmail.send",
  ],
  calendar: [
    "https://www.googleapis.com/auth/calendar.events",
  ],
  drive: [
    "https://www.googleapis.com/auth/drive.readonly",
  ],
  contacts: [
    "https://www.googleapis.com/auth/contacts.readonly",
  ],
};

const BASE_SCOPES = ["openid", "email"];

// --- Module state ---

let googleConfig: GoogleConfig | null = null;

// --- Lifecycle ---

export function startGoogle(config: GoogleConfig): void {
  googleConfig = config;
  console.log(`Google started (${config.google_email}, services: ${config.services.join(", ")})`);
}

export function stopGoogle(): void {
  googleConfig = null;
  console.log("Google stopped");
}

export function isGoogleRunning(): boolean {
  return googleConfig !== null;
}

export function getConnectedServices(): string[] | null {
  return googleConfig?.services || null;
}

// --- OAuth URL builder ---

export function buildOAuthUrl(services: string[]): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const instanceId = process.env.INSTANCE_ID;

  if (!clientId) throw new Error("GOOGLE_CLIENT_ID not configured");
  if (!instanceId) throw new Error("INSTANCE_ID not configured");

  const scopes = [
    ...BASE_SCOPES,
    ...services.flatMap((s) => SCOPE_MAP[s] || []),
  ];

  const statePayload = {
    instance_id: instanceId,
    hmac: crypto
      .createHmac("sha256", process.env.GATEWAY_TOKEN!)
      .update(instanceId)
      .digest("hex"),
    services,
  };
  const state = Buffer.from(JSON.stringify(statePayload)).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "https://api.agents.theagentpost.co/oauth/google/callback",
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// --- Token management ---

export async function getValidAccessToken(): Promise<string> {
  if (!googleConfig) throw new Error("Google not connected");

  const expiry = new Date(googleConfig.token_expiry).getTime();
  const fiveMinutes = 5 * 60 * 1000;

  if (Date.now() < expiry - fiveMinutes) {
    return googleConfig.access_token;
  }

  await refreshAccessToken();
  return googleConfig.access_token;
}

async function refreshAccessToken(): Promise<void> {
  if (!googleConfig) throw new Error("Google not configured");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: googleConfig.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    if (res.status === 400 && body.error === "invalid_grant") {
      upsertIntegration("google", "{}", "error", "Google access revoked. Please reconnect.");
      stopGoogle();
      throw new Error("Google refresh token revoked. Please reconnect.");
    }
    throw new Error(`Token refresh failed (${res.status}): ${JSON.stringify(body)}`);
  }

  const tokens: any = await res.json();
  googleConfig.access_token = tokens.access_token;
  googleConfig.token_expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Persist to DB
  const config = encrypt(JSON.stringify(googleConfig));
  upsertIntegration("google", config, "connected");
}

// --- HTTP helper ---

async function googleFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getValidAccessToken();
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(url, { ...options, headers });

  // Retry once on 401 (token may have just expired)
  if (res.status === 401) {
    await refreshAccessToken();
    const newToken = googleConfig!.access_token;
    headers.set("Authorization", `Bearer ${newToken}`);
    res = await fetch(url, { ...options, headers });
  }

  return res;
}

// --- Gmail API ---

export async function gmailSearch(query: string, maxResults = 10): Promise<string> {
  const params = new URLSearchParams({ q: query, maxResults: String(Math.min(maxResults, 20)) });
  const res = await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
  if (!res.ok) return JSON.stringify({ error: `Gmail search failed (${res.status})` });

  const data: any = await res.json();
  if (!data.messages || data.messages.length === 0) {
    return JSON.stringify({ messages: [], total: 0 });
  }

  // Fetch snippet for each message
  const messages = await Promise.all(
    data.messages.slice(0, maxResults).map(async (m: any) => {
      const msgRes = await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
      );
      if (!msgRes.ok) return { id: m.id, error: "Failed to fetch" };
      const msg: any = await msgRes.json();
      const headers: Record<string, string> = {};
      for (const h of msg.payload?.headers || []) {
        headers[h.name.toLowerCase()] = h.value;
      }
      return {
        id: msg.id,
        threadId: msg.threadId,
        from: headers.from || "",
        to: headers.to || "",
        subject: headers.subject || "",
        date: headers.date || "",
        snippet: msg.snippet || "",
        labelIds: msg.labelIds || [],
      };
    })
  );

  return JSON.stringify({ messages, total: data.resultSizeEstimate || messages.length });
}

export async function gmailReadMessage(messageId: string): Promise<string> {
  const res = await googleFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`
  );
  if (!res.ok) return JSON.stringify({ error: `Failed to read message (${res.status})` });

  const msg: any = await res.json();
  const headers: Record<string, string> = {};
  for (const h of msg.payload?.headers || []) {
    headers[h.name.toLowerCase()] = h.value;
  }

  // Extract body text
  let body = "";
  function extractText(part: any): void {
    if (part.mimeType === "text/plain" && part.body?.data) {
      body += Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    if (part.parts) {
      for (const p of part.parts) extractText(p);
    }
  }
  if (msg.payload) extractText(msg.payload);

  return JSON.stringify({
    id: msg.id,
    threadId: msg.threadId,
    from: headers.from || "",
    to: headers.to || "",
    subject: headers.subject || "",
    date: headers.date || "",
    body: body.slice(0, 10000),
    labelIds: msg.labelIds || [],
  });
}

export async function gmailSend(to: string, subject: string, body: string): Promise<string> {
  const email = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    body,
  ].join("\r\n");

  const raw = Buffer.from(email).toString("base64url");
  const res = await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Send failed (${res.status})` });
  }

  const result: any = await res.json();
  return JSON.stringify({ success: true, messageId: result.id });
}

export async function gmailCreateDraft(to: string, subject: string, body: string): Promise<string> {
  const email = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    body,
  ].join("\r\n");

  const raw = Buffer.from(email).toString("base64url");
  const res = await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Draft failed (${res.status})` });
  }

  const result: any = await res.json();
  return JSON.stringify({ success: true, draftId: result.id });
}

export async function gmailAddLabel(messageId: string, labelName: string): Promise<string> {
  // First, find or get the label ID
  const labelsRes = await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/labels");
  if (!labelsRes.ok) return JSON.stringify({ error: "Failed to list labels" });

  const labelsData: any = await labelsRes.json();
  const label = (labelsData.labels || []).find(
    (l: any) => l.name.toLowerCase() === labelName.toLowerCase() || l.id === labelName
  );

  if (!label) {
    return JSON.stringify({ error: `Label not found: ${labelName}` });
  }

  const res = await googleFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addLabelIds: [label.id] }),
    }
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Label failed (${res.status})` });
  }

  return JSON.stringify({ success: true, labelId: label.id, labelName: label.name });
}

// --- Calendar API ---

export async function calendarListEvents(
  timeMin?: string,
  timeMax?: string,
  maxResults = 10
): Promise<string> {
  const now = new Date().toISOString();
  const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const params = new URLSearchParams({
    timeMin: timeMin || now,
    timeMax: timeMax || weekFromNow,
    maxResults: String(Math.min(maxResults, 50)),
    singleEvents: "true",
    orderBy: "startTime",
  });

  const res = await googleFetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`
  );
  if (!res.ok) return JSON.stringify({ error: `Calendar list failed (${res.status})` });

  const data: any = await res.json();
  const events = (data.items || []).map((e: any) => ({
    id: e.id,
    summary: e.summary || "",
    start: e.start?.dateTime || e.start?.date || "",
    end: e.end?.dateTime || e.end?.date || "",
    description: e.description || "",
    location: e.location || "",
    attendees: (e.attendees || []).map((a: any) => a.email),
    status: e.status,
  }));

  return JSON.stringify({ events, total: events.length });
}

export async function calendarCreateEvent(event: {
  summary: string;
  start: string;
  end: string;
  description?: string;
  attendees?: string;
  location?: string;
}): Promise<string> {
  const body: any = {
    summary: event.summary,
    start: { dateTime: event.start },
    end: { dateTime: event.end },
  };
  if (event.description) body.description = event.description;
  if (event.location) body.location = event.location;
  if (event.attendees) {
    body.attendees = event.attendees.split(",").map((e) => ({ email: e.trim() }));
  }

  const res = await googleFetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Create event failed (${res.status})` });
  }

  const result: any = await res.json();
  return JSON.stringify({
    success: true,
    eventId: result.id,
    htmlLink: result.htmlLink,
    summary: result.summary,
    start: result.start?.dateTime || result.start?.date,
    end: result.end?.dateTime || result.end?.date,
  });
}

export async function calendarUpdateEvent(
  eventId: string,
  updates: {
    summary?: string;
    start?: string;
    end?: string;
    description?: string;
  }
): Promise<string> {
  const body: any = {};
  if (updates.summary) body.summary = updates.summary;
  if (updates.start) body.start = { dateTime: updates.start };
  if (updates.end) body.end = { dateTime: updates.end };
  if (updates.description) body.description = updates.description;

  const res = await googleFetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Update failed (${res.status})` });
  }

  const result: any = await res.json();
  return JSON.stringify({ success: true, eventId: result.id, summary: result.summary });
}

export async function calendarDeleteEvent(eventId: string): Promise<string> {
  const res = await googleFetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    { method: "DELETE" }
  );

  if (!res.ok && res.status !== 204) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Delete failed (${res.status})` });
  }

  return JSON.stringify({ success: true, deleted: eventId });
}

// --- Drive API ---

export async function driveSearch(query: string, maxResults = 10, mimeType?: string): Promise<string> {
  // Build query: try fullText first, fall back to name
  const escaped = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  let driveQuery = `(name contains '${escaped}' or fullText contains '${escaped}')`;
  if (mimeType) {
    driveQuery += ` and mimeType = '${mimeType}'`;
  }
  // Exclude trashed files
  driveQuery += " and trashed = false";

  const params = new URLSearchParams({
    q: driveQuery,
    pageSize: String(Math.min(maxResults, 20)),
    fields: "files(id,name,mimeType,modifiedTime,size,webViewLink)",
    orderBy: "modifiedTime desc",
  });

  const res = await googleFetch(`https://www.googleapis.com/drive/v3/files?${params}`);
  if (!res.ok) return JSON.stringify({ error: `Drive search failed (${res.status})` });

  const data: any = await res.json();
  return JSON.stringify({
    files: (data.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      size: f.size,
      webViewLink: f.webViewLink,
    })),
  });
}

export async function driveReadFile(fileId: string): Promise<string> {
  // First get file metadata
  const metaRes = await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType`
  );
  if (!metaRes.ok) return JSON.stringify({ error: `File not found (${metaRes.status})` });
  const meta: any = await metaRes.json();

  // For Google Docs/Sheets/Slides, export as text
  let contentUrl: string;
  if (meta.mimeType === "application/vnd.google-apps.document") {
    contentUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
  } else if (meta.mimeType === "application/vnd.google-apps.spreadsheet") {
    contentUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`;
  } else if (meta.mimeType === "application/vnd.google-apps.presentation") {
    contentUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
  } else {
    contentUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  }

  const contentRes = await googleFetch(contentUrl);
  if (!contentRes.ok) return JSON.stringify({ error: `Failed to read file (${contentRes.status})` });

  const text = await contentRes.text();
  return JSON.stringify({
    id: meta.id,
    name: meta.name,
    mimeType: meta.mimeType,
    content: text.slice(0, 50000),
  });
}

export async function driveCreateFile(
  name: string,
  content: string,
  mimeType?: string,
  folderId?: string
): Promise<string> {
  const metadata: any = { name };
  if (mimeType === "application/vnd.google-apps.document") {
    metadata.mimeType = mimeType;
  }
  if (folderId) {
    metadata.parents = [folderId];
  }

  // Multipart upload
  const boundary = "openclaw_boundary";
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType || "text/plain"}`,
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");

  const res = await googleFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Create file failed (${res.status})` });
  }

  const result: any = await res.json();
  return JSON.stringify({
    success: true,
    fileId: result.id,
    name: result.name,
    webViewLink: result.webViewLink,
  });
}

export function extractDriveFileId(url: string): string | null {
  // Matches: docs.google.com/document/d/{ID}, spreadsheets/d/{ID}, presentation/d/{ID}, drive.google.com/file/d/{ID}
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// --- Contacts (People) API ---

export async function contactsSearch(query: string): Promise<string> {
  const params = new URLSearchParams({
    query,
    readMask: "names,emailAddresses,phoneNumbers",
    pageSize: "10",
  });

  const res = await googleFetch(
    `https://people.googleapis.com/v1/people:searchContacts?${params}`
  );
  if (!res.ok) return JSON.stringify({ error: `Contacts search failed (${res.status})` });

  const data: any = await res.json();
  const contacts = (data.results || []).map((r: any) => {
    const person = r.person || {};
    return {
      resourceName: person.resourceName,
      name: person.names?.[0]?.displayName || "",
      email: person.emailAddresses?.[0]?.value || "",
      phone: person.phoneNumbers?.[0]?.value || "",
    };
  });

  return JSON.stringify({ contacts });
}

export async function contactsCreate(contact: {
  given_name: string;
  family_name?: string;
  email?: string;
  phone?: string;
}): Promise<string> {
  const body: any = {
    names: [
      {
        givenName: contact.given_name,
        familyName: contact.family_name || "",
      },
    ],
  };
  if (contact.email) {
    body.emailAddresses = [{ value: contact.email }];
  }
  if (contact.phone) {
    body.phoneNumbers = [{ value: contact.phone }];
  }

  const res = await googleFetch(
    "https://people.googleapis.com/v1/people:createContact?personFields=names,emailAddresses,phoneNumbers",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Create contact failed (${res.status})` });
  }

  const result: any = await res.json();
  return JSON.stringify({
    success: true,
    resourceName: result.resourceName,
    name: result.names?.[0]?.displayName || "",
  });
}
