// Agree.com — Contract lifecycle management
// Create agreements from templates, send for e-signature, manage contacts.

const AGREE_API = "https://secure.agree.com/api/v1";

interface AgreeConfig {
  api_key: string;
}

let agreeConfig: AgreeConfig | null = null;

export function startAgree(config: AgreeConfig): void {
  agreeConfig = config;
}

export function stopAgree(): void {
  agreeConfig = null;
}

export function isAgreeRunning(): boolean {
  return agreeConfig !== null;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${agreeConfig!.api_key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function testAgreeConnection(apiKey: string): Promise<{ success: boolean }> {
  const res = await fetch(`${AGREE_API}/agreements/templates`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("Invalid API key. Check your Agree.com API key.");
    throw new Error(`Agree.com API error (${res.status}): ${await res.text()}`);
  }
  return { success: true };
}

// --- Templates ---

export async function agreeListTemplates(): Promise<string> {
  if (!agreeConfig) return JSON.stringify({ error: "Agree.com is not connected" });
  try {
    const res = await fetch(`${AGREE_API}/agreements/templates`, { headers: headers() });
    if (!res.ok) return JSON.stringify({ error: `API error (${res.status}): ${await res.text()}` });
    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list templates" });
  }
}

export async function agreeGetTemplate(templateId: string): Promise<string> {
  if (!agreeConfig) return JSON.stringify({ error: "Agree.com is not connected" });
  try {
    const res = await fetch(`${AGREE_API}/agreements/templates/${templateId}`, { headers: headers() });
    if (!res.ok) return JSON.stringify({ error: `API error (${res.status}): ${await res.text()}` });
    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get template" });
  }
}

// --- Agreements ---

export async function agreeCreateAgreement(params: {
  template_id: string;
  name: string;
  recipients?: any[];
  field_values?: Record<string, any>;
  delivery_mode?: string;
  payments_enabled?: boolean;
  signing_order_enabled?: boolean;
}): Promise<string> {
  if (!agreeConfig) return JSON.stringify({ error: "Agree.com is not connected" });
  try {
    const body: any = {
      agreement: {
        template_id: params.template_id,
        name: params.name,
      },
    };
    if (params.recipients) body.agreement.recipients = params.recipients;
    if (params.field_values) body.agreement.field_values = params.field_values;
    if (params.delivery_mode) body.agreement.delivery_mode = params.delivery_mode;
    if (params.payments_enabled !== undefined) body.agreement.payments_enabled = params.payments_enabled;
    if (params.signing_order_enabled !== undefined) body.agreement.signing_order_enabled = params.signing_order_enabled;

    const res = await fetch(`${AGREE_API}/agreements`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) return JSON.stringify({ error: `API error (${res.status}): ${await res.text()}` });
    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create agreement" });
  }
}

export async function agreeCreateAndSend(params: {
  template_id: string;
  name: string;
  recipients?: any[];
  field_values?: Record<string, any>;
  delivery_mode?: string;
}): Promise<string> {
  if (!agreeConfig) return JSON.stringify({ error: "Agree.com is not connected" });
  try {
    const body: any = {
      agreement: {
        template_id: params.template_id,
        name: params.name,
      },
    };
    if (params.recipients) body.agreement.recipients = params.recipients;
    if (params.field_values) body.agreement.field_values = params.field_values;
    if (params.delivery_mode) body.agreement.delivery_mode = params.delivery_mode;

    const res = await fetch(`${AGREE_API}/agreements/create_and_send`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) return JSON.stringify({ error: `API error (${res.status}): ${await res.text()}` });
    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create and send agreement" });
  }
}

export async function agreeSendAgreement(agreementId: string, params?: {
  delivery_mode?: string;
  message?: string;
}): Promise<string> {
  if (!agreeConfig) return JSON.stringify({ error: "Agree.com is not connected" });
  try {
    const body: any = {};
    if (params?.delivery_mode) body.delivery_mode = params.delivery_mode;
    if (params?.message) body.message = params.message;

    const res = await fetch(`${AGREE_API}/agreements/${agreementId}/send`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) return JSON.stringify({ error: `API error (${res.status}): ${await res.text()}` });
    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to send agreement" });
  }
}

export async function agreeListAgreements(params?: { page?: number; page_size?: number }): Promise<string> {
  if (!agreeConfig) return JSON.stringify({ error: "Agree.com is not connected" });
  try {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.page_size) query.set("page_size", String(params.page_size));
    const qs = query.toString();

    const res = await fetch(`${AGREE_API}/agreements${qs ? `?${qs}` : ""}`, { headers: headers() });
    if (!res.ok) return JSON.stringify({ error: `API error (${res.status}): ${await res.text()}` });
    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list agreements" });
  }
}

export async function agreeGetAgreement(agreementId: string): Promise<string> {
  if (!agreeConfig) return JSON.stringify({ error: "Agree.com is not connected" });
  try {
    const res = await fetch(`${AGREE_API}/agreements/${agreementId}`, { headers: headers() });
    if (!res.ok) return JSON.stringify({ error: `API error (${res.status}): ${await res.text()}` });
    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get agreement" });
  }
}

// --- Contacts ---

export async function agreeListContacts(params?: { email?: string; company?: string; page?: number; page_size?: number }): Promise<string> {
  if (!agreeConfig) return JSON.stringify({ error: "Agree.com is not connected" });
  try {
    const query = new URLSearchParams();
    if (params?.email) query.set("email", params.email);
    if (params?.company) query.set("company", params.company);
    if (params?.page) query.set("page", String(params.page));
    if (params?.page_size) query.set("page_size", String(params.page_size));
    const qs = query.toString();

    const res = await fetch(`${AGREE_API}/contacts${qs ? `?${qs}` : ""}`, { headers: headers() });
    if (!res.ok) return JSON.stringify({ error: `API error (${res.status}): ${await res.text()}` });
    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list contacts" });
  }
}

export async function agreeCreateContact(params: {
  name: string;
  email: string;
  company?: string;
  title?: string;
}): Promise<string> {
  if (!agreeConfig) return JSON.stringify({ error: "Agree.com is not connected" });
  try {
    const body: any = { contact: { name: params.name, email: params.email } };
    if (params.company) body.contact.company = params.company;
    if (params.title) body.contact.title = params.title;

    const res = await fetch(`${AGREE_API}/contacts`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) return JSON.stringify({ error: `API error (${res.status}): ${await res.text()}` });
    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create contact" });
  }
}
