// Module state
interface MailchimpConfig {
  api_key: string;
  server: string; // data center prefix (e.g. "us6")
}

let mailchimpConfig: MailchimpConfig | null = null;

// --- Lifecycle ---

export function startMailchimp(config: MailchimpConfig): void {
  mailchimpConfig = config;
  console.log(`Mailchimp connected (${config.server})`);
}

export function stopMailchimp(): void {
  mailchimpConfig = null;
  console.log("Mailchimp disconnected");
}

export function isMailchimpRunning(): boolean {
  return mailchimpConfig !== null;
}

// --- Connection test ---

export async function testMailchimpConnection(apiKey: string): Promise<{ server: string; account_name: string }> {
  const server = apiKey.split("-").pop() || "";
  if (!server) throw new Error("Invalid API key format. Should end with -us1, -us6, etc.");

  const res = await fetch(`https://${server}.api.mailchimp.com/3.0/`, {
    headers: { Authorization: `Basic ${Buffer.from(`anystring:${apiKey}`).toString("base64")}` },
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Invalid API key.");
    throw new Error(`Mailchimp API error (${res.status}): ${await res.text()}`);
  }

  const data: any = await res.json();
  return { server, account_name: data.account_name || "" };
}

// --- API helpers ---

function baseUrl(): string {
  if (!mailchimpConfig) throw new Error("Mailchimp is not connected");
  return `https://${mailchimpConfig.server}.api.mailchimp.com/3.0`;
}

function headers(): Record<string, string> {
  if (!mailchimpConfig) throw new Error("Mailchimp is not connected");
  return {
    Authorization: `Basic ${Buffer.from(`anystring:${mailchimpConfig.api_key}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

// --- API wrappers ---

export async function mailchimpListAudiences(): Promise<string> {
  if (!mailchimpConfig) return JSON.stringify({ error: "Mailchimp is not connected" });
  try {
    const res = await fetch(`${baseUrl()}/lists?count=50&fields=lists.id,lists.name,lists.stats`, { headers: headers() });
    if (!res.ok) return JSON.stringify({ error: `Mailchimp API error (${res.status}): ${await res.text()}` });
    const data: any = await res.json();
    return JSON.stringify({
      audiences: (data.lists || []).map((l: any) => ({
        id: l.id,
        name: l.name,
        member_count: l.stats?.member_count,
        unsubscribe_count: l.stats?.unsubscribe_count,
      })),
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list audiences" });
  }
}

export async function mailchimpListCampaigns(params?: { status?: string; count?: number }): Promise<string> {
  if (!mailchimpConfig) return JSON.stringify({ error: "Mailchimp is not connected" });
  try {
    const query = new URLSearchParams();
    query.set("count", String(params?.count || 20));
    if (params?.status) query.set("status", params.status);
    query.set("fields", "campaigns.id,campaigns.settings.title,campaigns.settings.subject_line,campaigns.status,campaigns.send_time,campaigns.report_summary");

    const res = await fetch(`${baseUrl()}/campaigns?${query}`, { headers: headers() });
    if (!res.ok) return JSON.stringify({ error: `Mailchimp API error (${res.status}): ${await res.text()}` });
    const data: any = await res.json();
    return JSON.stringify({
      campaigns: (data.campaigns || []).map((c: any) => ({
        id: c.id,
        title: c.settings?.title,
        subject: c.settings?.subject_line,
        status: c.status,
        send_time: c.send_time,
        opens: c.report_summary?.opens,
        clicks: c.report_summary?.subscriber_clicks,
      })),
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list campaigns" });
  }
}

export async function mailchimpCreateCampaign(params: {
  list_id: string;
  subject: string;
  preview_text?: string;
  title?: string;
  from_name?: string;
  reply_to?: string;
  body_html: string;
}): Promise<string> {
  if (!mailchimpConfig) return JSON.stringify({ error: "Mailchimp is not connected" });
  try {
    // Step 1: Create campaign
    const createRes = await fetch(`${baseUrl()}/campaigns`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        type: "regular",
        recipients: { list_id: params.list_id },
        settings: {
          subject_line: params.subject,
          preview_text: params.preview_text || "",
          title: params.title || params.subject,
          from_name: params.from_name || undefined,
          reply_to: params.reply_to || undefined,
        },
      }),
    });

    if (!createRes.ok) return JSON.stringify({ error: `Create campaign failed (${createRes.status}): ${await createRes.text()}` });
    const campaign: any = await createRes.json();

    // Step 2: Set campaign content
    const contentRes = await fetch(`${baseUrl()}/campaigns/${campaign.id}/content`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ html: params.body_html }),
    });

    if (!contentRes.ok) return JSON.stringify({ error: `Set content failed (${contentRes.status}): ${await contentRes.text()}` });

    return JSON.stringify({
      success: true,
      id: campaign.id,
      title: campaign.settings?.title,
      subject: campaign.settings?.subject_line,
      status: campaign.status,
      web_id: campaign.web_id,
      archive_url: campaign.archive_url,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create campaign" });
  }
}

export async function mailchimpSendCampaign(campaignId: string): Promise<string> {
  if (!mailchimpConfig) return JSON.stringify({ error: "Mailchimp is not connected" });
  try {
    const res = await fetch(`${baseUrl()}/campaigns/${campaignId}/actions/send`, {
      method: "POST",
      headers: headers(),
    });
    if (!res.ok) return JSON.stringify({ error: `Send failed (${res.status}): ${await res.text()}` });
    return JSON.stringify({ success: true, status: "sent" });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to send campaign" });
  }
}

export async function mailchimpGetCampaignReport(campaignId: string): Promise<string> {
  if (!mailchimpConfig) return JSON.stringify({ error: "Mailchimp is not connected" });
  try {
    const res = await fetch(`${baseUrl()}/reports/${campaignId}`, { headers: headers() });
    if (!res.ok) return JSON.stringify({ error: `Report failed (${res.status}): ${await res.text()}` });
    const data: any = await res.json();
    return JSON.stringify({
      id: data.id,
      subject: data.subject_line,
      emails_sent: data.emails_sent,
      opens: data.opens?.opens_total,
      unique_opens: data.opens?.unique_opens,
      open_rate: data.opens?.open_rate,
      clicks: data.clicks?.clicks_total,
      unique_clicks: data.clicks?.unique_subscriber_clicks,
      click_rate: data.clicks?.click_rate,
      unsubscribes: data.unsubscribed,
      bounces: data.bounces?.hard_bounces + data.bounces?.soft_bounces,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get report" });
  }
}

export async function mailchimpAddSubscriber(listId: string, email: string, firstName?: string, lastName?: string, tags?: string[]): Promise<string> {
  if (!mailchimpConfig) return JSON.stringify({ error: "Mailchimp is not connected" });
  try {
    const body: any = {
      email_address: email,
      status: "subscribed",
    };
    if (firstName || lastName) {
      body.merge_fields = {};
      if (firstName) body.merge_fields.FNAME = firstName;
      if (lastName) body.merge_fields.LNAME = lastName;
    }
    if (tags?.length) body.tags = tags;

    const res = await fetch(`${baseUrl()}/lists/${listId}/members`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      if (err.title === "Member Exists") {
        return JSON.stringify({ success: true, status: "already_subscribed", email });
      }
      return JSON.stringify({ error: `Add subscriber failed (${res.status}): ${err.detail || err.title || "Unknown error"}` });
    }

    const data: any = await res.json();
    return JSON.stringify({ success: true, email: data.email_address, status: data.status, id: data.id });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to add subscriber" });
  }
}

export async function mailchimpListTemplates(): Promise<string> {
  if (!mailchimpConfig) return JSON.stringify({ error: "Mailchimp is not connected" });
  try {
    const res = await fetch(`${baseUrl()}/templates?count=50&type=user`, { headers: headers() });
    if (!res.ok) return JSON.stringify({ error: `Mailchimp API error (${res.status}): ${await res.text()}` });
    const data: any = await res.json();
    return JSON.stringify({
      templates: (data.templates || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        type: t.type,
      })),
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list templates" });
  }
}

export async function mailchimpUploadImage(base64Data: string, filename: string): Promise<string> {
  if (!mailchimpConfig) return JSON.stringify({ error: "Mailchimp is not connected" });
  try {
    const res = await fetch(`${baseUrl()}/file-manager/files`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        name: filename,
        file_data: base64Data,
      }),
    });

    if (!res.ok) return JSON.stringify({ error: `Upload failed (${res.status}): ${await res.text()}` });

    const data: any = await res.json();
    return JSON.stringify({
      success: true,
      id: data.id,
      name: data.name,
      url: data.full_size_url,
      thumbnail: data.thumbnail_url,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to upload image" });
  }
}
