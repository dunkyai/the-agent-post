import crypto from "crypto";
import { getIntegration, upsertIntegration, getSetting, setSetting, getGmailProcessedThread, getEmailThreadState } from "./db";
import { encrypt, decrypt } from "./encryption";
import { sanitizeEmailContent } from "./email";
import { processIncomingEmail, type EmailThreadContext } from "../adapters/email";

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
  const truncated = text.length > 200000;
  return JSON.stringify({
    id: meta.id,
    name: meta.name,
    mimeType: meta.mimeType,
    content: text.slice(0, 200000),
    total_chars: text.length,
    truncated,
    ...(truncated ? { note: `File is ${text.length} characters. Only the first 200,000 are shown.` } : {}),
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
          requests: [{ insertText: { location: { index: 1, tabId: doc.tabs?.[0]?.tabProperties?.tabId }, text: content } }],
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

function extractTextFromElements(elements: any[]): string {
  let text = "";
  for (const el of elements) {
    if (el.paragraph) {
      for (const pe of el.paragraph.elements || []) {
        if (pe.textRun?.content) text += pe.textRun.content;
      }
    }
    if (el.table) {
      for (const row of el.table.tableRows || []) {
        for (const cell of row.tableCells || []) {
          text += extractTextFromElements(cell.content || []);
          text += "\t";
        }
        text += "\n";
      }
    }
  }
  return text;
}

function extractTabsFromDoc(doc: any): { tabId: string; title: string; content: string }[] {
  const tabs: { tabId: string; title: string; content: string }[] = [];

  function processTabs(tabList: any[]): void {
    for (const tab of tabList) {
      if (tab.documentTab) {
        const tabId = tab.tabProperties?.tabId || "";
        const title = tab.tabProperties?.title || "";
        const content = extractTextFromElements(tab.documentTab.body?.content || []);
        tabs.push({ tabId, title, content });
      }
      // Process child tabs (nested)
      if (tab.childTabs?.length) {
        processTabs(tab.childTabs);
      }
    }
  }

  if (doc.tabs?.length) {
    processTabs(doc.tabs);
  } else if (doc.body?.content) {
    // Fallback for docs without tabs
    tabs.push({ tabId: "", title: "Main", content: extractTextFromElements(doc.body.content) });
  }

  return tabs;
}

export async function docsRead(documentId: string, tabName?: string, accountId?: string): Promise<string> {
  const res = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}?includeTabsContent=true`,
    {},
    accountId
  );
  if (!res.ok) return JSON.stringify({ error: `Failed to read document (${res.status})` });

  const doc: any = await res.json();
  const tabs = extractTabsFromDoc(doc);

  // If a specific tab is requested, find it by name (case-insensitive)
  if (tabName) {
    const match = tabs.find(t => t.title.toLowerCase() === tabName.toLowerCase());
    if (!match) {
      return JSON.stringify({
        error: `Tab "${tabName}" not found`,
        available_tabs: tabs.map(t => ({ tabId: t.tabId, title: t.title })),
      });
    }
    return JSON.stringify({
      documentId: doc.documentId,
      title: doc.title,
      tab: { tabId: match.tabId, title: match.title },
      content: match.content.slice(0, 50000),
    });
  }

  // Return all tabs
  const hasTabs = tabs.length > 1;
  if (hasTabs) {
    return JSON.stringify({
      documentId: doc.documentId,
      title: doc.title,
      tabs: tabs.map(t => ({
        tabId: t.tabId,
        title: t.title,
        content: t.content.slice(0, 20000),
      })),
    });
  }

  const content = tabs[0]?.content || "";
  const truncated = content.length > 200000;
  return JSON.stringify({
    documentId: doc.documentId,
    title: doc.title,
    content: content.slice(0, 200000),
    total_chars: content.length,
    truncated,
    ...(truncated ? { note: `Document is ${content.length} characters. Only the first 200,000 are shown. Content at the end of the document is not visible here.` } : {}),
    revisionId: doc.revisionId,
  });
}

export async function docsAppend(documentId: string, text: string, tabId?: string, accountId?: string): Promise<string> {
  const docRes = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}?includeTabsContent=true`,
    {},
    accountId
  );
  if (!docRes.ok) return JSON.stringify({ error: `Failed to read document (${docRes.status})` });

  const doc: any = await docRes.json();

  // Find the right tab's body content to get end index
  let bodyContent: any[] | undefined;
  if (tabId && doc.tabs?.length) {
    const findTab = (tabs: any[]): any => {
      for (const tab of tabs) {
        if (tab.tabProperties?.tabId === tabId) return tab;
        if (tab.childTabs?.length) {
          const found = findTab(tab.childTabs);
          if (found) return found;
        }
      }
      return null;
    };
    const tab = findTab(doc.tabs);
    if (!tab) return JSON.stringify({ error: `Tab ID "${tabId}" not found` });
    bodyContent = tab.documentTab?.body?.content;
  } else if (doc.tabs?.length) {
    bodyContent = doc.tabs[0]?.documentTab?.body?.content;
  } else {
    bodyContent = doc.body?.content;
  }

  const endIndex = bodyContent?.[bodyContent.length - 1]?.endIndex;
  if (!endIndex || endIndex < 2) {
    return JSON.stringify({ error: "Could not determine document end index" });
  }

  const location: any = { index: endIndex - 1 };
  if (tabId) location.tabId = tabId;

  const res = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{ insertText: { location, text: "\n" + text } }],
      }),
    },
    accountId
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Append failed (${res.status})` });
  }

  return JSON.stringify({ success: true, documentId, appended_chars: text.length, note: "Text was appended at the end of the document. If the document is longer than 200,000 characters, docs_read may not show the appended content due to truncation — but it IS there." });
}

export async function docsInsert(documentId: string, text: string, index: number, tabId?: string, accountId?: string): Promise<string> {
  const location: any = { index };
  if (tabId) location.tabId = tabId;

  const res = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{ insertText: { location, text } }],
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

export async function docsSuggestEdit(
  documentId: string,
  oldText: string,
  newText: string,
  tabId?: string,
  accountId?: string
): Promise<string> {
  // 1. Read the document to find the text and its character index
  const docRes = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}?includeTabsContent=true`,
    {},
    accountId
  );
  if (!docRes.ok) return JSON.stringify({ error: `Failed to read document (${docRes.status})` });

  const doc: any = await docRes.json();

  // Get the body content for the target tab
  let bodyContent: any[] | undefined;
  let resolvedTabId: string | undefined = tabId;
  if (doc.tabs?.length) {
    if (tabId) {
      const findTab = (tabs: any[]): any => {
        for (const tab of tabs) {
          if (tab.tabProperties?.tabId === tabId) return tab;
          if (tab.childTabs?.length) {
            const found = findTab(tab.childTabs);
            if (found) return found;
          }
        }
        return null;
      };
      const tab = findTab(doc.tabs);
      if (!tab) return JSON.stringify({ error: `Tab ID "${tabId}" not found` });
      bodyContent = tab.documentTab?.body?.content;
    } else {
      bodyContent = doc.tabs[0]?.documentTab?.body?.content;
      resolvedTabId = doc.tabs[0]?.tabProperties?.tabId;
    }
  } else {
    bodyContent = doc.body?.content;
  }

  if (!bodyContent) return JSON.stringify({ error: "Could not read document content" });

  // 2. Extract full text with index tracking to find the old text's position
  let fullText = "";
  const indexMap: { charPos: number; docIndex: number }[] = [];

  for (const el of bodyContent) {
    if (el.paragraph) {
      for (const pe of el.paragraph.elements || []) {
        if (pe.textRun?.content) {
          const startIndex = pe.startIndex || 0;
          for (let i = 0; i < pe.textRun.content.length; i++) {
            indexMap.push({ charPos: fullText.length + i, docIndex: startIndex + i });
          }
          fullText += pe.textRun.content;
        }
      }
    }
  }

  // 3. Find the old text in the document
  const matchPos = fullText.indexOf(oldText);
  if (matchPos === -1) {
    // Try case-insensitive search
    const lowerPos = fullText.toLowerCase().indexOf(oldText.toLowerCase());
    if (lowerPos === -1) {
      return JSON.stringify({
        error: "Could not find the specified text in the document",
        hint: "Make sure the text matches exactly, including spacing and punctuation",
      });
    }
    // Use the case-insensitive match position
    const startDocIndex = indexMap[lowerPos].docIndex;
    const endDocIndex = indexMap[lowerPos + oldText.length - 1].docIndex + 1;
    return applyRedline(documentId, startDocIndex, endDocIndex, newText, resolvedTabId, accountId);
  }

  const startDocIndex = indexMap[matchPos].docIndex;
  const endDocIndex = indexMap[matchPos + oldText.length - 1].docIndex + 1;
  return applyRedline(documentId, startDocIndex, endDocIndex, newText, resolvedTabId, accountId);
}

/** Find text in a document and return its start/end document indices */
async function findTextIndices(
  documentId: string,
  text: string,
  tabId?: string,
  accountId?: string
): Promise<{ startIndex: number; endIndex: number; tabId?: string } | { error: string }> {
  const docRes = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}?includeTabsContent=true`,
    {},
    accountId
  );
  if (!docRes.ok) return { error: `Failed to read document (${docRes.status})` };

  const doc: any = await docRes.json();

  let bodyContent: any[] | undefined;
  let resolvedTabId: string | undefined = tabId;
  if (doc.tabs?.length) {
    if (tabId) {
      const findTab = (tabs: any[]): any => {
        for (const tab of tabs) {
          if (tab.tabProperties?.tabId === tabId) return tab;
          if (tab.childTabs?.length) {
            const found = findTab(tab.childTabs);
            if (found) return found;
          }
        }
        return null;
      };
      const tab = findTab(doc.tabs);
      if (!tab) return { error: `Tab ID "${tabId}" not found` };
      bodyContent = tab.documentTab?.body?.content;
    } else {
      bodyContent = doc.tabs[0]?.documentTab?.body?.content;
      resolvedTabId = doc.tabs[0]?.tabProperties?.tabId;
    }
  } else {
    bodyContent = doc.body?.content;
  }

  if (!bodyContent) return { error: "Could not read document content" };

  let fullText = "";
  const indexMap: { charPos: number; docIndex: number }[] = [];
  for (const el of bodyContent) {
    if (el.paragraph) {
      for (const pe of el.paragraph.elements || []) {
        if (pe.textRun?.content) {
          const startIndex = pe.startIndex || 0;
          for (let i = 0; i < pe.textRun.content.length; i++) {
            indexMap.push({ charPos: fullText.length + i, docIndex: startIndex + i });
          }
          fullText += pe.textRun.content;
        }
      }
    }
  }

  let matchPos = fullText.indexOf(text);
  if (matchPos === -1) {
    matchPos = fullText.toLowerCase().indexOf(text.toLowerCase());
    if (matchPos === -1) return { error: "Could not find the specified text in the document" };
  }

  return {
    startIndex: indexMap[matchPos].docIndex,
    endIndex: indexMap[matchPos + text.length - 1].docIndex + 1,
    tabId: resolvedTabId,
  };
}

export async function docsFormatText(
  documentId: string,
  text: string,
  formatting: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    fontSize?: number;
    fontFamily?: string;
    foregroundColor?: { red?: number; green?: number; blue?: number };
    link?: string;
  },
  tabId?: string,
  accountId?: string
): Promise<string> {
  const result = await findTextIndices(documentId, text, tabId, accountId);
  if ("error" in result) return JSON.stringify(result);

  const { startIndex, endIndex, tabId: resolvedTabId } = result;

  // Build the textStyle and fields list
  const textStyle: any = {};
  const fields: string[] = [];

  if (formatting.bold !== undefined) { textStyle.bold = formatting.bold; fields.push("bold"); }
  if (formatting.italic !== undefined) { textStyle.italic = formatting.italic; fields.push("italic"); }
  if (formatting.underline !== undefined) { textStyle.underline = formatting.underline; fields.push("underline"); }
  if (formatting.strikethrough !== undefined) { textStyle.strikethrough = formatting.strikethrough; fields.push("strikethrough"); }
  if (formatting.fontSize !== undefined) {
    textStyle.fontSize = { magnitude: formatting.fontSize, unit: "PT" };
    fields.push("fontSize");
  }
  if (formatting.fontFamily !== undefined) {
    textStyle.weightedFontFamily = { fontFamily: formatting.fontFamily };
    fields.push("weightedFontFamily");
  }
  if (formatting.foregroundColor !== undefined) {
    textStyle.foregroundColor = { color: { rgbColor: formatting.foregroundColor } };
    fields.push("foregroundColor");
  }
  if (formatting.link !== undefined) {
    textStyle.link = formatting.link ? { url: formatting.link } : {};
    fields.push("link");
  }

  if (fields.length === 0) return JSON.stringify({ error: "No formatting options specified" });

  const request: any = {
    updateTextStyle: {
      range: { startIndex, endIndex },
      textStyle,
      fields: fields.join(","),
    },
  };
  if (resolvedTabId) request.updateTextStyle.range.tabId = resolvedTabId;

  const res = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [request] }),
    },
    accountId
  );

  if (!res.ok) {
    const body = await res.text();
    return JSON.stringify({ error: `Failed to format text (${res.status}): ${body}` });
  }

  const appliedChanges = fields.map(f => {
    if (f === "bold") return formatting.bold ? "bold" : "unbold";
    if (f === "italic") return formatting.italic ? "italic" : "unitalic";
    if (f === "underline") return formatting.underline ? "underline" : "remove underline";
    if (f === "strikethrough") return formatting.strikethrough ? "strikethrough" : "remove strikethrough";
    if (f === "fontSize") return `font size ${formatting.fontSize}pt`;
    if (f === "weightedFontFamily") return `font ${formatting.fontFamily}`;
    if (f === "foregroundColor") return "text color";
    if (f === "link") return formatting.link ? `linked to ${formatting.link}` : "link removed";
    return f;
  });
  return JSON.stringify({ success: true, changes: appliedChanges.join(", "), text_matched: text.substring(0, 50) });
}

export async function docsParagraphStyle(
  documentId: string,
  text: string,
  style: {
    heading?: string;
    alignment?: string;
    lineSpacing?: number;
    spaceAbove?: number;
    spaceBelow?: number;
  },
  tabId?: string,
  accountId?: string
): Promise<string> {
  const result = await findTextIndices(documentId, text, tabId, accountId);
  if ("error" in result) return JSON.stringify(result);

  const { startIndex, endIndex, tabId: resolvedTabId } = result;

  const paragraphStyle: any = {};
  const fields: string[] = [];

  if (style.heading !== undefined) {
    paragraphStyle.namedStyleType = style.heading;
    fields.push("namedStyleType");
  }
  if (style.alignment !== undefined) {
    paragraphStyle.alignment = style.alignment;
    fields.push("alignment");
  }
  if (style.lineSpacing !== undefined) {
    paragraphStyle.lineSpacing = style.lineSpacing;
    fields.push("lineSpacing");
  }
  if (style.spaceAbove !== undefined) {
    paragraphStyle.spaceAbove = { magnitude: style.spaceAbove, unit: "PT" };
    fields.push("spaceAbove");
  }
  if (style.spaceBelow !== undefined) {
    paragraphStyle.spaceBelow = { magnitude: style.spaceBelow, unit: "PT" };
    fields.push("spaceBelow");
  }

  if (fields.length === 0) return JSON.stringify({ error: "No paragraph style options specified" });

  const request: any = {
    updateParagraphStyle: {
      range: { startIndex, endIndex },
      paragraphStyle,
      fields: fields.join(","),
    },
  };
  if (resolvedTabId) request.updateParagraphStyle.range.tabId = resolvedTabId;

  const res = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [request] }),
    },
    accountId
  );

  if (!res.ok) {
    const body = await res.text();
    return JSON.stringify({ error: `Failed to update paragraph style (${res.status}): ${body}` });
  }

  const appliedChanges = fields.map(f => {
    if (f === "namedStyleType") return `heading: ${style.heading}`;
    if (f === "alignment") return `alignment: ${style.alignment?.toLowerCase()}`;
    if (f === "lineSpacing") return `line spacing: ${style.lineSpacing}%`;
    if (f === "spaceAbove") return `space above: ${style.spaceAbove}pt`;
    if (f === "spaceBelow") return `space below: ${style.spaceBelow}pt`;
    return f;
  });
  return JSON.stringify({ success: true, changes: appliedChanges.join(", "), text_matched: text.substring(0, 50) });
}

export async function docsCreateList(
  documentId: string,
  text: string,
  listType: "BULLET" | "NUMBER" | "NONE",
  tabId?: string,
  accountId?: string
): Promise<string> {
  const result = await findTextIndices(documentId, text, tabId, accountId);
  if ("error" in result) return JSON.stringify(result);

  const { startIndex, endIndex, tabId: resolvedTabId } = result;

  let request: any;
  if (listType === "NONE") {
    request = { deleteParagraphBullets: { range: { startIndex, endIndex } } };
    if (resolvedTabId) request.deleteParagraphBullets.range.tabId = resolvedTabId;
  } else {
    const preset = listType === "NUMBER"
      ? "NUMBERED_DECIMAL_NESTED"
      : "BULLET_DISC_CIRCLE_SQUARE";
    request = {
      createParagraphBullets: {
        range: { startIndex, endIndex },
        bulletPreset: preset,
      },
    };
    if (resolvedTabId) request.createParagraphBullets.range.tabId = resolvedTabId;
  }

  const res = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [request] }),
    },
    accountId
  );

  if (!res.ok) {
    const body = await res.text();
    return JSON.stringify({ error: `Failed to update list (${res.status}): ${body}` });
  }

  const action = listType === "NONE" ? "removed bullets/numbering" : `applied ${listType.toLowerCase()} list`;
  return JSON.stringify({ success: true, action, text_matched: text.substring(0, 50) });
}

export async function docsInsertImage(
  documentId: string,
  imageUrl: string,
  index?: number,
  width?: number,
  height?: number,
  tabId?: string,
  accountId?: string
): Promise<string> {
  // If no index provided, find the end of the document
  let insertIndex = index;
  if (insertIndex === undefined) {
    const docRes = await googleFetch(
      `https://docs.googleapis.com/v1/documents/${documentId}?includeTabsContent=true`,
      {},
      accountId
    );
    if (!docRes.ok) return JSON.stringify({ error: `Failed to read document (${docRes.status})` });

    const doc: any = await docRes.json();
    let bodyContent: any[] | undefined;
    if (doc.tabs?.length) {
      if (tabId) {
        const findTab = (tabs: any[]): any => {
          for (const tab of tabs) {
            if (tab.tabProperties?.tabId === tabId) return tab;
            if (tab.childTabs?.length) {
              const found = findTab(tab.childTabs);
              if (found) return found;
            }
          }
          return null;
        };
        const tab = findTab(doc.tabs);
        bodyContent = tab?.documentTab?.body?.content;
      } else {
        bodyContent = doc.tabs[0]?.documentTab?.body?.content;
      }
    } else {
      bodyContent = doc.body?.content;
    }

    if (!bodyContent?.length) return JSON.stringify({ error: "Could not determine document end index" });
    const lastElement = bodyContent[bodyContent.length - 1];
    insertIndex = (lastElement.endIndex || 1) - 1;
  }

  const request: any = {
    insertInlineImage: {
      location: { index: insertIndex },
      uri: imageUrl,
    },
  };
  if (tabId) request.insertInlineImage.location.tabId = tabId;
  if (width || height) {
    request.insertInlineImage.objectSize = {};
    if (width) request.insertInlineImage.objectSize.width = { magnitude: width, unit: "PT" };
    if (height) request.insertInlineImage.objectSize.height = { magnitude: height, unit: "PT" };
  }

  const res = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [request] }),
    },
    accountId
  );

  if (!res.ok) {
    const body = await res.text();
    return JSON.stringify({ error: `Failed to insert image (${res.status}): ${body}` });
  }

  return JSON.stringify({ success: true, imageUrl, index: insertIndex });
}

export async function docsReplaceText(
  documentId: string,
  findText: string,
  replaceText: string,
  matchCase: boolean = true,
  tabId?: string,
  accountId?: string
): Promise<string> {
  const replaceRequest: any = {
    replaceAllText: {
      containsText: { text: findText, matchCase },
      replaceText,
    },
  };
  if (tabId) {
    replaceRequest.replaceAllText.tabsCriteria = { tabIds: [tabId] };
  }

  const res = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [replaceRequest] }),
    },
    accountId
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Replace failed (${res.status})` });
  }

  const data: any = await res.json();
  const occurrences = data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
  return JSON.stringify({ success: true, documentId, occurrences_replaced: occurrences, find: findText, replace: replaceText });
}

async function applyRedline(
  documentId: string,
  startIndex: number,
  endIndex: number,
  newText: string,
  tabId?: string,
  accountId?: string
): Promise<string> {
  // Build the batchUpdate requests:
  // 1. Insert new text right after the old text (in green/blue)
  // 2. Apply strikethrough + red color to old text
  // Order matters: do inserts first (from end to start) to preserve indices

  const insertLocation: any = { index: endIndex };
  if (tabId) insertLocation.tabId = tabId;

  const strikethroughRange: any = { startIndex, endIndex };
  if (tabId) strikethroughRange.tabId = tabId;

  const newTextStart = endIndex;
  const newTextEnd = endIndex + newText.length;
  const newTextRange: any = { startIndex: newTextStart, endIndex: newTextEnd };
  if (tabId) newTextRange.tabId = tabId;

  const requests = [
    // Insert the replacement text after the original
    {
      insertText: {
        location: insertLocation,
        text: newText,
      },
    },
    // Style the new text in blue
    {
      updateTextStyle: {
        range: newTextRange,
        textStyle: {
          foregroundColor: {
            color: { rgbColor: { red: 0.0, green: 0.4, blue: 0.8 } },
          },
        },
        fields: "foregroundColor",
      },
    },
    // Apply strikethrough + red to the original text
    {
      updateTextStyle: {
        range: strikethroughRange,
        textStyle: {
          strikethrough: true,
          foregroundColor: {
            color: { rgbColor: { red: 0.8, green: 0.0, blue: 0.0 } },
          },
        },
        fields: "strikethrough,foregroundColor",
      },
    },
  ];

  const res = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    },
    accountId
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    return JSON.stringify({ error: err.error?.message || `Suggest edit failed (${res.status})` });
  }

  return JSON.stringify({
    success: true,
    documentId,
    message: "Suggested edit applied — original text is shown in red strikethrough, new text in blue. Review in the document and delete whichever version you don't want.",
  });
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

export function startGmailPolling(): void {
  stopGmailPolling();

  const intervalMs = parseInt(getSetting("gmail_poll_interval") || "0", 10);
  if (!intervalMs || intervalMs <= 0) return;

  // Find first account with Gmail
  const account = Array.from(googleAccounts.values()).find(a => a.services.includes("gmail"));
  if (!account) return;

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

/** Extract a clean lowercase email address from a "Name <email>" or bare "email" string */
function extractEmailAddress(from: string): string {
  const match = from.toLowerCase().trim().match(/<([^>]+)>/);
  return match ? match[1] : from.toLowerCase().trim();
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
  const ownEmail = accountId.toLowerCase();

  try {
    const query = "in:inbox";
    console.log(`Gmail poll: searching (${accountId}) q="${query}"`);
    const params = new URLSearchParams({ q: query, maxResults: "20" });
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

    // Deduplicate by thread — keep only one message per thread
    const threadIds = [...new Set(rawMessages.map(m => m.threadId).filter(Boolean))];
    console.log(`Gmail poll: ${rawMessages.length} message(s) found, ${threadIds.length} unique thread(s)`);

    // Helper to extract text from email parts
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

    for (const threadId of threadIds) {
      try {
        // Fetch the full thread
        const threadRes = await googleFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
          {},
          accountId
        );
        if (!threadRes.ok) continue;

        const threadData: any = await threadRes.json();
        const threadMsgs = threadData.messages || [];
        if (threadMsgs.length === 0) continue;

        // Get the latest message
        const lastMsg = threadMsgs[threadMsgs.length - 1];
        const lastMsgId = lastMsg.id;
        const lastHeaders: Record<string, string> = {};
        for (const h of lastMsg.payload?.headers || []) {
          lastHeaders[h.name.toLowerCase()] = h.value;
        }

        const subject = lastHeaders.subject || "";
        const latestFrom = lastHeaders.from || "";

        // Skip if latest message is from own account (already replied)
        const lastFromEmail = extractEmailAddress(latestFrom);
        const isOwnMessage = lastFromEmail === ownEmail
          || (ownEmail.includes("@") && lastFromEmail === ownEmail.split("@")[0] + "@googlemail.com")
          || (ownEmail.includes("@googlemail.com") && lastFromEmail === ownEmail.replace("@googlemail.com", "@gmail.com"));
        if (isOwnMessage) {
          continue;
        }

        // Check sender against email rules
        if (!isGmailSenderAllowed(latestFrom)) {
          continue;
        }

        // Check if already processed (and no state machine activity)
        const processed = getGmailProcessedThread(threadId);
        const threadState = getEmailThreadState(threadId, accountId);

        // Skip if already processed this exact message AND no active state machine
        if (processed && processed.last_message_id === lastMsgId) {
          // Unless we're awaiting_reply — a new message might have arrived
          if (!threadState || threadState.state !== "awaiting_reply") {
            continue;
          }
          // If awaiting_reply but same message, still waiting
          if (threadState.latest_message_id === lastMsgId) {
            continue;
          }
        }

        // Build EmailThreadContext with all messages in the thread
        const latestTo = lastHeaders.to || "";
        const latestCc = lastHeaders.cc || "";
        const allRecipients = [latestTo, latestCc].filter(Boolean).join(", ");

        const threadMessages: EmailThreadContext["threadMessages"] = [];
        for (const msg of threadMsgs) {
          const msgHeaders: Record<string, string> = {};
          for (const h of msg.payload?.headers || []) {
            msgHeaders[h.name.toLowerCase()] = h.value;
          }
          let msgBody = msg.payload ? extractTextFromPart(msg.payload) : "";
          msgBody = sanitizeEmailContent(msgBody);
          threadMessages.push({
            from: msgHeaders.from || "",
            body: msgBody,
            timestamp: msgHeaders.date || "",
            messageId: msg.id,
          });
        }

        const ctx: EmailThreadContext = {
          threadId,
          accountId,
          subject,
          latestMessageId: lastMsgId,
          latestSender: latestFrom,
          allRecipients,
          messageIdHeader: lastHeaders["message-id"] || "",
          threadMessages,
          ownEmail,
        };

        // Hand off to the email adapter for triage + processing
        await processIncomingEmail(ctx);

      } catch (err: unknown) {
        console.error(`Gmail poll: error processing thread ${threadId}:`, err instanceof Error ? err.message : err);
      }
    }

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
