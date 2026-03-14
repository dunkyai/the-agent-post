import { processMessage } from "./ai";

const LOBSTERMAIL_API = "https://api.lobstermail.ai";

let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastChecked: string | null = null;
let emailConfig: {
  apiToken: string;
  inboxId: string;
  emailAddress: string;
} | null = null;

export async function signupAndCreateInbox(): Promise<{
  apiToken: string;
  inboxId: string;
  emailAddress: string;
}> {
  const signupRes = await fetch(`${LOBSTERMAIL_API}/v1/signup`, {
    method: "POST",
  });
  if (!signupRes.ok) {
    throw new Error(`LobsterMail signup failed (${signupRes.status}): ${await signupRes.text()}`);
  }
  const signupData: any = await signupRes.json();
  const apiToken = signupData.token;

  return createInbox(apiToken);
}

export async function createInbox(apiToken: string): Promise<{
  apiToken: string;
  inboxId: string;
  emailAddress: string;
}> {
  const inboxRes = await fetch(`${LOBSTERMAIL_API}/v1/inboxes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({ displayName: "OpenClaw Agent" }),
  });
  if (!inboxRes.ok) {
    throw new Error(`Inbox creation failed (${inboxRes.status}): ${await inboxRes.text()}`);
  }
  const inboxData: any = await inboxRes.json();

  return {
    apiToken,
    inboxId: inboxData.id,
    emailAddress: inboxData.address || `${inboxData.localPart}@${inboxData.domain || "lobstermail.ai"}`,
  };
}

export function startEmail(config: {
  apiToken: string;
  inboxId: string;
  emailAddress: string;
}): void {
  if (pollInterval) {
    stopEmail();
  }

  emailConfig = config;
  lastChecked = null;

  pollEmails();
  pollInterval = setInterval(() => pollEmails(), 30000);

  console.log(`Email polling started for ${config.emailAddress}`);
}

async function pollEmails(): Promise<void> {
  if (!emailConfig) return;

  try {
    const params = new URLSearchParams({ unread: "true" });
    if (lastChecked) params.set("since", lastChecked);

    const res = await fetch(
      `${LOBSTERMAIL_API}/v1/inboxes/${emailConfig.inboxId}/emails?${params}`,
      { headers: { Authorization: `Bearer ${emailConfig.apiToken}` } }
    );

    if (!res.ok) {
      console.error(`Email poll error (${res.status}):`, await res.text());
      return;
    }

    const data: any = await res.json();
    const emails = data.data || data.emails || [];

    for (const email of emails) {
      const sender = email.from || email.sender || "unknown";
      const subject = email.subject || "";
      const body = email.preview || (typeof email.body === "string" ? email.body : email.body?.text || email.body?.html || "");
      const text = subject ? `Subject: ${subject}\n\n${body}` : body;
      if (!text.trim()) continue;

      try {
        const reply = await processMessage(
          "email",
          sender,
          text,
          `You are responding via email. Your email address is ${emailConfig!.emailAddress}.`
        );
        await sendReply(sender, subject, reply);
      } catch (err: unknown) {
        console.error("Email processing error:", err instanceof Error ? err.message : err);
      }
    }

    lastChecked = new Date().toISOString();
  } catch (err: unknown) {
    console.error("Email poll error:", err instanceof Error ? err.message : err);
  }
}

async function sendReply(to: string, originalSubject: string, body: string): Promise<void> {
  if (!emailConfig) return;

  try {
    const subject = originalSubject
      ? `Re: ${originalSubject.replace(/^Re:\s*/i, "")}`
      : "Re: your message";

    const res = await fetch(`${LOBSTERMAIL_API}/v1/emails/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${emailConfig.apiToken}`,
      },
      body: JSON.stringify({
        from: emailConfig.emailAddress,
        to: [to],
        subject,
        body: { text: body },
      }),
    });

    if (res.status === 403) {
      console.log("Email send skipped (Tier 0 — upgrade to send replies)");
      return;
    }

    if (!res.ok) {
      console.error(`Email send error (${res.status}):`, await res.text());
    }
  } catch (err: unknown) {
    console.error("Email send error:", err instanceof Error ? err.message : err);
  }
}

export function stopEmail(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  emailConfig = null;
  lastChecked = null;
  console.log("Email polling stopped");
}

export function isEmailRunning(): boolean {
  return pollInterval !== null;
}

export async function checkInbox(maxResults = 10): Promise<string> {
  if (!emailConfig) return JSON.stringify({ error: "Email is not configured" });

  try {
    const params = new URLSearchParams({ limit: String(Math.min(maxResults, 20)) });
    const res = await fetch(
      `${LOBSTERMAIL_API}/v1/inboxes/${emailConfig.inboxId}/emails?${params}`,
      { headers: { Authorization: `Bearer ${emailConfig.apiToken}` } }
    );

    if (!res.ok) {
      return JSON.stringify({ error: `Failed to check inbox (${res.status})` });
    }

    const data: any = await res.json();
    const emails = (data.data || data.emails || []).map((e: any) => ({
      id: e.id,
      from: e.from || e.sender || "unknown",
      subject: e.subject || "",
      preview: (e.preview || e.body?.text || e.body?.html || "").slice(0, 200),
      date: e.receivedAt || e.createdAt || e.date || "",
      read: !!e.read,
    }));

    return JSON.stringify({ inbox: emailConfig.emailAddress, emails, total: emails.length });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to check inbox" });
  }
}

export async function sendEmailMessage(to: string, subject: string, body: string): Promise<void> {
  if (!emailConfig) throw new Error("Email is not configured");

  const res = await fetch(`${LOBSTERMAIL_API}/v1/emails/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${emailConfig.apiToken}`,
    },
    body: JSON.stringify({
      from: emailConfig.emailAddress,
      to: [to],
      subject,
      body: { text: body },
    }),
  });

  if (res.status === 403) {
    console.log("Email send skipped (Tier 0)");
    return;
  }

  if (!res.ok) {
    throw new Error(`Email send error (${res.status}): ${await res.text()}`);
  }
}
