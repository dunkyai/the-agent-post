import crypto from "crypto";
import { getIntegration, upsertIntegration, getSetting, setSetting } from "./db";
import { encrypt, decrypt } from "./encryption";
import { processMessage } from "./ai";
import { sanitizeEmailContent } from "./email";

// --- Types ---

export interface GoogleConfig {
  access_token: string;
  refresh_token: string;
  token_expiry: string;
  services: string[];
  google_email: string;
}

export interface GoogleAccountInfo {
  accountId: string;
  email: string;
  services: string[];
}

// --- Scope mapping ---

const SCOPE_MAP: Record<string, string[]> = {
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.labels",
  ],
  gmail_send: [
    "https://www.googleapis.com/auth/gmail.compose",
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
  docs: [
    "https://www.googleapis.com/auth/documents",
  ],
  sheets: [
    "https://www.googleapis.com/auth/spreadsheets",
  ],
};

const BASE_SCOPES = ["openid", "email"];

// --- Module state (multi-account) ---

const googleAccounts = new Map<string, GoogleConfig>();

// --- Lifecycle ---

export function startGoogle(config: GoogleConfig): void {
  const accountId = config.google_email;
  googleAccounts.set(accountId, config);
  console.log(`Google started (${accountId}, services: ${config.services.join(", ")})`);
}

export function stopGoogle(accountId?: string): void {
  if (accountId) {
    googleAccounts.delete(accountId);
    console.log(`Google stopped (${accountId})`);
  } else {
    googleAccounts.clear();
    console.log("Google stopped (all accounts)");
  }
}

export function isGoogleRunning(): boolean {
  return googleAccounts.size > 0;
}

export function getGoogleAccounts(): GoogleAccountInfo[] {
  return Array.from(googleAccounts.entries()).map(([id, config]) => ({
    accountId: id,
    email: config.google_email,
    services: config.services,
  }));
}

export function getGoogleAccount(accountId: string): GoogleConfig | null {
  return googleAccounts.get(accountId) || null;
}

function resolveAccount(accountId?: string): GoogleConfig {
  if (accountId) {
    const config = googleAccounts.get(accountId);
    if (!config) throw new Error(`Google account not connected: ${accountId}`);
    return config;
  }
  if (googleAccounts.size === 0) throw new Error("Google not connected");
  // Default to first account
  return googleAccounts.values().next().value!;
}

export function getConnectedServices(): string[] | null {
  if (googleAccounts.size === 0) return null;
  // Union of all accounts' services
  const allServices = new Set<string>();
  for (const config of googleAccounts.values()) {
    for (const svc of config.services) allServices.add(svc);
  }
  return Array.from(allServices);
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

export async function getValidAccessToken(accountId?: string): Promise<string> {
  const config = resolveAccount(accountId);

  const expiry = new Date(config.token_expiry).getTime();
  const fiveMinutes = 5 * 60 * 1000;

  if (Date.now() < expiry - fiveMinutes) {
    return config.access_token;
  }

  await refreshAccessToken(config.google_email);
  return config.access_token;
}

async function refreshAccessToken(accountId?: string): Promise<void> {
  const config = resolveAccount(accountId);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: config.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    if (res.status === 400 && body.error === "invalid_grant") {
      const typeKey = `google:${config.google_email}`;
      upsertIntegration(typeKey, "{}", "error", "Google access revoked. Please reconnect.");
      stopGoogle(config.google_email);
      throw new Error(`Google refresh token revoked for ${config.google_email}. Please reconnect.`);
    }
    throw new Error(`Token refresh failed (${res.status}): ${JSON.stringify(body)}`);
  }

  const tokens: any = await res.json();
  config.access_token = tokens.access_token;
  config.token_expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Persist to DB with google:<email> key
  const encrypted = encrypt(JSON.stringify(config));
  upsertIntegration(`google:${config.google_email}`, encrypted, "connected");
}

// --- HTTP helper ---

async function googleFetch(url: string, options: RequestInit = {}, accountId?: string): Promise<Response> {
  const token = await getValidAccessToken(accountId);
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(url, { ...options, headers });

  // Retry once on 401 (token may have just expired)
  if (res.status === 401) {
    await refreshAccessToken(accountId);
    const config = resolveAccount(accountId);
    headers.set("Authorization", `Bearer ${config.access_token}`);
    res = await fetch(url, { ...options, headers });
  }

  return res;
}

// --- Gmail API ---

export async function gmailSearch(query: string, maxResults = 10, accountId?: string): Promise<string> {
  const params = new URLSearchParams({ q: query, maxResults: String(Math.min(maxResults, 20)) });
  const res = await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {}, accountId);
  if (!res.ok) return JSON.stringify({ error: `Gmail search failed (${res.status})` });

  const data: any = await res.json();
  if (!data.messages || data.messages.length === 0) {
    return JSON.stringify({ messages: [], total: 0 });
  }

  // Fetch snippet for each message
  const messages = await Promise.all(
    data.messages.slice(0, maxResults).map(async (m: any) => {
      const msgRes = await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        {},
        accountId
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

  return JSON.stringify({ messages, total: messages.length });
}

export async function gmailReadMessage(messageId: string, accountId?: string): Promise<string> {
  const res = await googleFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    {},
    accountId
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
    messageId: headers["message-id"] || "",
    from: headers.from || "",
    to: headers.to || "",
    cc: headers.cc || "",
    subject: headers.subject || "",
    date: headers.date || "",
    body: body.slice(0, 10000),
    labelIds: msg.labelIds || [],
  });
}

export async function gmailSend(to: string, subject: string, body: string, accountId?: string, from?: string, cc?: string, threadId?: string, inReplyTo?: string): Promise<string> {
  const emailHeaders = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
  ];
  if (from) emailHeaders.unshift(`From: ${from}`);
  if (cc) emailHeaders.push(`Cc: ${cc}`);
  if (inReplyTo) {
    emailHeaders.push(`In-Reply-To: ${inReplyTo}`);
    emailHeaders.push(`References: ${inReplyTo}`);
  }

  const email = [...emailHeaders, "", body].join("\r\n");

  const raw = Buffer.from(email).toString("base64url");
  const msgPayload: any = { raw };
  if (threadId) msgPayload.threadId = threadId;
  const res = await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msgPayload),
  }, accountId);

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Send failed (${res.status})` });
  }

  const result: any = await res.json();
  return JSON.stringify({ success: true, messageId: result.id });
}

export async function gmailCreateDraft(to: string, subject: string, body: string, accountId?: string, from?: string, cc?: string, threadId?: string, inReplyTo?: string): Promise<string> {
  const emailHeaders = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
  ];
  if (from) emailHeaders.unshift(`From: ${from}`);
  if (cc) emailHeaders.push(`Cc: ${cc}`);
  if (inReplyTo) {
    emailHeaders.push(`In-Reply-To: ${inReplyTo}`);
    emailHeaders.push(`References: ${inReplyTo}`);
  }

  const email = [...emailHeaders, "", body].join("\r\n");

  const raw = Buffer.from(email).toString("base64url");
  const msgPayload: any = { raw };
  if (threadId) msgPayload.threadId = threadId;
  const res = await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: msgPayload }),
  }, accountId);

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Draft failed (${res.status})` });
  }

  const result: any = await res.json();
  return JSON.stringify({ success: true, draftId: result.id });
}

export async function gmailAddLabel(messageId: string, labelName: string, accountId?: string): Promise<string> {
  // First, find or get the label ID
  const labelsRes = await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {}, accountId);
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
    },
    accountId
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Label failed (${res.status})` });
  }

  return JSON.stringify({ success: true, labelId: label.id, labelName: label.name });
}

export async function gmailGetSendAsAliases(accountId?: string): Promise<string> {
  const res = await googleFetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
    {},
    accountId
  );
  if (!res.ok) return JSON.stringify({ error: `Failed to list aliases (${res.status})` });

  const data: any = await res.json();
  const aliases = (data.sendAs || []).map((a: any) => ({
    email: a.sendAsEmail,
    displayName: a.displayName || "",
    isDefault: a.isDefault || false,
    isPrimary: a.isPrimary || false,
  }));

  return JSON.stringify({ aliases });
}

// --- Calendar API ---

export async function calendarListEvents(
  timeMin?: string,
  timeMax?: string,
  maxResults = 10,
  accountId?: string
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
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    {},
    accountId
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
}, accountId?: string): Promise<string> {
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
    },
    accountId
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
  },
  accountId?: string
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
    },
    accountId
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Update failed (${res.status})` });
  }

  const result: any = await res.json();
  return JSON.stringify({ success: true, eventId: result.id, summary: result.summary });
}

export async function calendarDeleteEvent(eventId: string, accountId?: string): Promise<string> {
  const res = await googleFetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    { method: "DELETE" },
    accountId
  );

  if (!res.ok && res.status !== 204) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Delete failed (${res.status})` });
  }

  return JSON.stringify({ success: true, deleted: eventId });
}

// --- Drive API ---

export async function driveSearch(query: string, maxResults = 10, mimeType?: string, accountId?: string): Promise<string> {
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

  const res = await googleFetch(`https://www.googleapis.com/drive/v3/files?${params}`, {}, accountId);
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

export async function driveReadFile(fileId: string, accountId?: string): Promise<string> {
  // First get file metadata
  const metaRes = await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType`,
    {},
    accountId
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

  const contentRes = await googleFetch(contentUrl, {}, accountId);
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
  folderId?: string,
  accountId?: string
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
    },
    accountId
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

export async function contactsSearch(query: string, accountId?: string): Promise<string> {
  const params = new URLSearchParams({
    query,
    readMask: "names,emailAddresses,phoneNumbers",
    pageSize: "10",
  });

  const res = await googleFetch(
    `https://people.googleapis.com/v1/people:searchContacts?${params}`,
    {},
    accountId
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
}, accountId?: string): Promise<string> {
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
    },
    accountId
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

// --- Google Docs API ---

export async function docsCreate(title: string, content?: string, accountId?: string): Promise<string> {
  const res = await googleFetch(
    "https://docs.googleapis.com/v1/documents",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
    accountId
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Create doc failed (${res.status})` });
  }

  const doc: any = await res.json();

  if (content) {
    const insertRes = await googleFetch(
      `https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{ insertText: { location: { index: 1 }, text: content } }],
        }),
      },
      accountId
    );
    if (!insertRes.ok) {
      return JSON.stringify({
        success: true,
        documentId: doc.documentId,
        title: doc.title,
        warning: "Document created but initial content insertion failed",
      });
    }
  }

  return JSON.stringify({
    success: true,
    documentId: doc.documentId,
    title: doc.title,
    documentUrl: `https://docs.google.com/document/d/${doc.documentId}/edit`,
  });
}

export async function docsRead(documentId: string, accountId?: string): Promise<string> {
  const res = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}`,
    {},
    accountId
  );
  if (!res.ok) return JSON.stringify({ error: `Failed to read document (${res.status})` });

  const doc: any = await res.json();

  let text = "";
  function extractText(elements: any[]): void {
    for (const el of elements) {
      if (el.paragraph) {
        for (const pe of el.paragraph.elements || []) {
          if (pe.textRun?.content) text += pe.textRun.content;
        }
      }
      if (el.table) {
        for (const row of el.table.tableRows || []) {
          for (const cell of row.tableCells || []) {
            extractText(cell.content || []);
            text += "\t";
          }
          text += "\n";
        }
      }
    }
  }

  if (doc.body?.content) extractText(doc.body.content);

  return JSON.stringify({
    documentId: doc.documentId,
    title: doc.title,
    content: text.slice(0, 50000),
    revisionId: doc.revisionId,
  });
}

export async function docsAppend(documentId: string, text: string, accountId?: string): Promise<string> {
  const docRes = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}`,
    {},
    accountId
  );
  if (!docRes.ok) return JSON.stringify({ error: `Failed to read document (${docRes.status})` });

  const doc: any = await docRes.json();
  const body = doc.body;
  const endIndex = body?.content?.[body.content.length - 1]?.endIndex;
  if (!endIndex || endIndex < 2) {
    return JSON.stringify({ error: "Could not determine document end index" });
  }

  const res = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{ insertText: { location: { index: endIndex - 1 }, text: "\n" + text } }],
      }),
    },
    accountId
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Append failed (${res.status})` });
  }

  return JSON.stringify({ success: true, documentId });
}

export async function docsInsert(documentId: string, text: string, index: number, accountId?: string): Promise<string> {
  const res = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{ insertText: { location: { index }, text } }],
      }),
    },
    accountId
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Insert failed (${res.status})` });
  }

  return JSON.stringify({ success: true, documentId, insertedAt: index });
}

// --- Google Sheets API ---

export async function sheetsCreate(title: string, sheetTitles?: string[], accountId?: string): Promise<string> {
  const reqBody: any = { properties: { title } };
  if (sheetTitles && sheetTitles.length > 0) {
    reqBody.sheets = sheetTitles.map((t) => ({ properties: { title: t } }));
  }

  const res = await googleFetch(
    "https://sheets.googleapis.com/v4/spreadsheets",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    },
    accountId
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Create spreadsheet failed (${res.status})` });
  }

  const result: any = await res.json();
  return JSON.stringify({
    success: true,
    spreadsheetId: result.spreadsheetId,
    title: result.properties.title,
    spreadsheetUrl: result.spreadsheetUrl,
    sheets: (result.sheets || []).map((s: any) => s.properties.title),
  });
}

export async function sheetsRead(spreadsheetId: string, range: string, accountId?: string): Promise<string> {
  const params = new URLSearchParams({
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const res = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?${params}`,
    {},
    accountId
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Read range failed (${res.status})` });
  }

  const data: any = await res.json();
  return JSON.stringify({
    range: data.range,
    values: data.values || [],
    rows: (data.values || []).length,
  });
}

export async function sheetsWrite(spreadsheetId: string, range: string, values: any[][], accountId?: string): Promise<string> {
  const params = new URLSearchParams({ valueInputOption: "USER_ENTERED" });

  const res = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?${params}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ range, majorDimension: "ROWS", values }),
    },
    accountId
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Write failed (${res.status})` });
  }

  const result: any = await res.json();
  return JSON.stringify({
    success: true,
    updatedRange: result.updatedRange,
    updatedRows: result.updatedRows,
    updatedColumns: result.updatedColumns,
    updatedCells: result.updatedCells,
  });
}

export async function sheetsAppend(spreadsheetId: string, range: string, values: any[][], accountId?: string): Promise<string> {
  const params = new URLSearchParams({
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
  });

  const res = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?${params}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ range, majorDimension: "ROWS", values }),
    },
    accountId
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Append failed (${res.status})` });
  }

  const result: any = await res.json();
  return JSON.stringify({
    success: true,
    updatedRange: result.updates?.updatedRange,
    updatedRows: result.updates?.updatedRows,
    updatedCells: result.updates?.updatedCells,
  });
}

export async function sheetsListSheets(spreadsheetId: string, accountId?: string): Promise<string> {
  const res = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties`,
    {},
    accountId
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `List sheets failed (${res.status})` });
  }

  const data: any = await res.json();
  return JSON.stringify({
    spreadsheetTitle: data.properties.title,
    sheets: (data.sheets || []).map((s: any) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      index: s.properties.index,
      rowCount: s.properties.gridProperties?.rowCount,
      columnCount: s.properties.gridProperties?.columnCount,
    })),
  });
}

// --- Gmail Polling ---

let gmailPollInterval: ReturnType<typeof setInterval> | null = null;
let gmailLastChecked: string | null = null;

export function startGmailPolling(): void {
  stopGmailPolling();

  const intervalMs = parseInt(getSetting("gmail_poll_interval") || "0", 10);
  if (!intervalMs || intervalMs <= 0) return;

  // Find first account with Gmail
  const account = Array.from(googleAccounts.values()).find(a => a.services.includes("gmail"));
  if (!account) return;

  gmailLastChecked = getSetting("gmail_last_checked") || null;

  // Poll immediately, then on interval
  pollGmail().catch(err => console.error("Gmail poll error:", err));
  gmailPollInterval = setInterval(() => pollGmail().catch(err => console.error("Gmail poll error:", err)), intervalMs);

  console.log(`Gmail polling started (every ${intervalMs / 60000} min)`);
}

export function stopGmailPolling(): void {
  if (gmailPollInterval) {
    clearInterval(gmailPollInterval);
    gmailPollInterval = null;
  }
}

export function isGmailPollingRunning(): boolean {
  return gmailPollInterval !== null;
}

function isGmailSenderAllowed(sender: string): boolean {
  try {
    const rules = JSON.parse(getSetting("gmail_email_rules") || "{}");
    if (!rules.mode || rules.mode === "all") return true;

    const senderLower = sender.trim().toLowerCase();
    // Extract email from "Name <email>" format
    const emailMatch = senderLower.match(/<([^>]+)>/);
    const email = emailMatch ? emailMatch[1] : senderLower;
    const domain = email.split("@")[1];

    if (rules.mode === "domains" && rules.domains?.length > 0) {
      return rules.domains.some((d: string) => d.toLowerCase() === domain);
    }
    if (rules.mode === "addresses" && rules.addresses?.length > 0) {
      return rules.addresses.some((a: string) => a.toLowerCase() === email);
    }
  } catch {}
  return true;
}

async function pollGmail(): Promise<void> {
  const account = Array.from(googleAccounts.values()).find(a => a.services.includes("gmail"));
  if (!account) return;

  const accountId = account.google_email;

  try {
    // Build search query — only Primary tab to avoid promotions/social/updates
    let query = "in:inbox category:primary";
    if (gmailLastChecked) {
      const epoch = Math.floor(new Date(gmailLastChecked).getTime() / 1000);
      query += ` after:${epoch}`;
    } else {
      // First run: only process unread to avoid processing entire inbox history
      query += " is:unread";
    }

    console.log(`Gmail poll: searching (${accountId}) q="${query}"`);
    const params = new URLSearchParams({ q: query, maxResults: "10" });
    const res = await googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      {},
      accountId
    );
    if (!res.ok) {
      const body = await res.text();
      console.error(`Gmail poll search failed (${res.status}): ${body}`);
      return;
    }

    const data: any = await res.json();
    const rawMessages: { id: string; threadId: string }[] = (data.messages || []).map((m: any) => ({
      id: m.id,
      threadId: m.threadId,
    }));

    if (rawMessages.length === 0) {
      console.log("Gmail poll: 0 emails found");
      return;
    }

    // Deduplicate by thread — keep only the first (newest) message per thread
    const seenThreads = new Set<string>();
    const messageIds: string[] = [];
    for (const m of rawMessages) {
      if (m.threadId && seenThreads.has(m.threadId)) continue;
      if (m.threadId) seenThreads.add(m.threadId);
      messageIds.push(m.id);
    }

    console.log(`Gmail poll: ${rawMessages.length} message(s) found, ${messageIds.length} unique thread(s)`);

    const replyMode = getSetting("gmail_reply_mode") || "draft";
    const ownEmail = accountId.toLowerCase();

    // Build set of thread IDs that already have drafts
    const draftThreadIds = new Set<string>();
    try {
      const draftsRes = await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=100`,
        {},
        accountId
      );
      if (draftsRes.ok) {
        const draftsData: any = await draftsRes.json();
        for (const d of draftsData.drafts || []) {
          if (d.message?.threadId) draftThreadIds.add(d.message.threadId);
        }
      }
    } catch {}

    for (const msgId of messageIds) {
      try {
        // Fetch full message
        const msgRes = await googleFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
          {},
          accountId
        );
        if (!msgRes.ok) continue;

        const msg: any = await msgRes.json();
        const headers: Record<string, string> = {};
        for (const h of msg.payload?.headers || []) {
          headers[h.name.toLowerCase()] = h.value;
        }

        const from = headers.from || "";
        const subject = headers.subject || "";
        const threadId = msg.threadId;

        // Skip if we already have a draft for this thread
        if (threadId && draftThreadIds.has(threadId)) {
          console.log(`Gmail poll: skipped (draft already exists) — ${subject}`);
          await markAsRead(msgId, accountId);
          continue;
        }

        // Check sender against rules
        if (!isGmailSenderAllowed(from)) {
          console.log(`Gmail poll: filtered out email from ${from}`);
          await markAsRead(msgId, accountId);
          continue;
        }

        // Fetch the full thread to get the latest message for proper reply threading
        let latestFrom = from;
        let latestTo = headers.to || "";
        let latestCc = headers.cc || "";
        let latestMessageId = headers["message-id"] || "";
        let latestBody = "";
        let allMessageIds: string[] = [msgId]; // track all message IDs in thread to mark as read

        if (threadId) {
          try {
            const threadRes = await googleFetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
              {},
              accountId
            );
            if (threadRes.ok) {
              const threadData: any = await threadRes.json();
              const threadMsgs = threadData.messages || [];

              // Collect all message IDs in thread for marking as read
              allMessageIds = threadMsgs.map((m: any) => m.id);

              if (threadMsgs.length > 0) {
                const lastMsg = threadMsgs[threadMsgs.length - 1];
                const lastHeaders: Record<string, string> = {};
                for (const h of lastMsg.payload?.headers || []) {
                  lastHeaders[h.name.toLowerCase()] = h.value;
                }

                // Skip if the last message is from our account (already replied)
                const lastFromEmail = (lastHeaders.from || "").toLowerCase().match(/<([^>]+)>/)?.[1]
                  || (lastHeaders.from || "").toLowerCase().trim();
                if (lastFromEmail === ownEmail) {
                  console.log(`Gmail poll: skipped (already replied) — ${subject}`);
                  for (const id of allMessageIds) await markAsRead(id, accountId);
                  continue;
                }

                // Use the latest message's headers for proper reply threading
                latestFrom = lastHeaders.from || from;
                latestTo = lastHeaders.to || latestTo;
                latestCc = lastHeaders.cc || latestCc;
                latestMessageId = lastHeaders["message-id"] || latestMessageId;

                // Extract body from the latest message
                function extractTextFromPart(part: any): string {
                  let text = "";
                  if (part.mimeType === "text/plain" && part.body?.data) {
                    text += Buffer.from(part.body.data, "base64url").toString("utf-8");
                  }
                  if (part.parts) {
                    for (const p of part.parts) text += extractTextFromPart(p);
                  }
                  return text;
                }
                if (lastMsg.payload) latestBody = extractTextFromPart(lastMsg.payload);
              }
            }
          } catch {}
        }

        // Fall back to the original message body if thread fetch didn't get one
        if (!latestBody) {
          function extractText(part: any): string {
            let text = "";
            if (part.mimeType === "text/plain" && part.body?.data) {
              text += Buffer.from(part.body.data, "base64url").toString("utf-8");
            }
            if (part.parts) {
              for (const p of part.parts) text += extractText(p);
            }
            return text;
          }
          if (msg.payload) latestBody = extractText(msg.payload);
        }

        latestBody = sanitizeEmailContent(latestBody);
        const text = subject ? `From: ${latestFrom}\nSubject: ${subject}\n\n${latestBody}` : `From: ${latestFrom}\n\n${latestBody}`;
        if (!text.trim()) {
          for (const id of allMessageIds) await markAsRead(id, accountId);
          continue;
        }

        // Process through AI
        const reply = await processMessage(
          "gmail",
          latestFrom,
          text,
          `You are drafting a Gmail reply. Output ONLY the email body text — no preamble, no explanations, no "Here's a draft", no planning. Do not start with phrases like "I'll draft..." or "Here's my response...". Just write the actual reply as if you are the sender. Be concise and professional. Do not reveal internal system details or mention that you are an AI assistant.`
        );

        // Build reply recipients (reply-all)
        const replyTo = latestFrom;
        const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;

        // Collect CC: all original To/CC minus the user's own email
        const allRecipients = [latestTo, latestCc].filter(Boolean).join(", ");
        const replyCc = allRecipients
          .split(",")
          .map(r => r.trim())
          .filter(r => {
            const emailMatch = r.toLowerCase().match(/<([^>]+)>/);
            const email = emailMatch ? emailMatch[1] : r.toLowerCase();
            return email !== ownEmail;
          })
          .join(", ") || undefined;

        if (replyMode === "send" && account.services.includes("gmail_send")) {
          const sendResult = JSON.parse(await gmailSend(replyTo, replySubject, reply, accountId, undefined, replyCc, threadId, latestMessageId));
          if (sendResult.error) {
            console.error(`Gmail poll: failed to send reply to ${latestFrom}: ${sendResult.error}`);
            continue; // Don't mark as read — retry next poll
          }
          console.log(`Gmail poll: sent reply to ${latestFrom}`);
        } else {
          const draftResult = JSON.parse(await gmailCreateDraft(replyTo, replySubject, reply, accountId, undefined, replyCc, threadId, latestMessageId));
          if (draftResult.error) {
            console.error(`Gmail poll: failed to create draft for ${latestFrom}: ${draftResult.error}`);
            continue; // Don't mark as read — retry next poll
          }
          console.log(`Gmail poll: drafted reply to ${latestFrom} (draftId: ${draftResult.draftId})`);
          if (threadId) draftThreadIds.add(threadId);
        }

        // Mark all messages in thread as read after successful draft/send
        for (const id of allMessageIds) await markAsRead(id, accountId);
      } catch (err: unknown) {
        console.error(`Gmail poll: error processing message ${msgId}:`, err instanceof Error ? err.message : err);
      }
    }

    gmailLastChecked = new Date().toISOString();
    setSetting("gmail_last_checked", gmailLastChecked);
  } catch (err: unknown) {
    console.error("Gmail poll error:", err instanceof Error ? err.message : err);
  }
}

async function markAsRead(messageId: string, accountId: string): Promise<void> {
  await googleFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    },
    accountId
  ).catch(() => {});
}
