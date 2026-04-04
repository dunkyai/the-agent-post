const CONTACTOUT_API = "https://api.contactout.com";

// Module state
interface ContactOutConfig {
  api_token: string;
}

let contactoutConfig: ContactOutConfig | null = null;

// --- Lifecycle ---

export function startContactOut(config: ContactOutConfig): void {
  contactoutConfig = config;
  console.log("ContactOut connected");
}

export function stopContactOut(): void {
  contactoutConfig = null;
  console.log("ContactOut disconnected");
}

export function isContactOutRunning(): boolean {
  return contactoutConfig !== null;
}

// --- Connection test ---

export async function testContactOutConnection(apiToken: string): Promise<{ success: boolean }> {
  const res = await fetch(`${CONTACTOUT_API}/v1/stats`, {
    headers: {
      authorization: "basic",
      token: apiToken,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 401) {
      throw new Error("Invalid API token. Get your token from ContactOut settings.");
    }
    throw new Error(`ContactOut API error (${res.status}): ${await res.text()}`);
  }

  return { success: true };
}

// --- API helpers ---

function headers(): Record<string, string> {
  if (!contactoutConfig) throw new Error("ContactOut is not connected");
  return {
    authorization: "basic",
    token: contactoutConfig.api_token,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// --- API wrappers ---

export async function contactoutSearchPeople(params: {
  name?: string;
  job_title?: string[];
  company?: string[];
  location?: string[];
  seniority?: string[];
  industry?: string[];
  keyword?: string;
  reveal_info?: boolean;
  page?: number;
}): Promise<string> {
  if (!contactoutConfig) return JSON.stringify({ error: "ContactOut is not connected" });

  try {
    const res = await fetch(`${CONTACTOUT_API}/v1/people/search`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        ...params,
        reveal_info: params.reveal_info ?? false,
      }),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `ContactOut API error (${res.status}): ${await res.text()}` });
    }

    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "People search failed" });
  }
}

export async function contactoutEnrichPerson(params: {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  linkedin_url?: string;
  email?: string;
  company?: string[];
  company_domain?: string[];
  location?: string;
  job_title?: string;
  include?: string[];
}): Promise<string> {
  if (!contactoutConfig) return JSON.stringify({ error: "ContactOut is not connected" });

  try {
    const res = await fetch(`${CONTACTOUT_API}/v1/people/enrich`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        ...params,
        include: params.include ?? ["work_email", "personal_email", "phone"],
      }),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `ContactOut API error (${res.status}): ${await res.text()}` });
    }

    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Person enrichment failed" });
  }
}

export async function contactoutEnrichLinkedIn(linkedinUrl: string, includePhone = true): Promise<string> {
  if (!contactoutConfig) return JSON.stringify({ error: "ContactOut is not connected" });

  try {
    const url = `${CONTACTOUT_API}/v1/linkedin/enrich?profile=${encodeURIComponent(linkedinUrl)}`;
    const res = await fetch(url, { headers: headers() });

    if (!res.ok) {
      return JSON.stringify({ error: `ContactOut API error (${res.status}): ${await res.text()}` });
    }

    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "LinkedIn enrichment failed" });
  }
}

export async function contactoutEnrichEmail(email: string): Promise<string> {
  if (!contactoutConfig) return JSON.stringify({ error: "ContactOut is not connected" });

  try {
    const url = `${CONTACTOUT_API}/v1/email/enrich?email=${encodeURIComponent(email)}&include=work_email`;
    const res = await fetch(url, { headers: headers() });

    if (!res.ok) {
      return JSON.stringify({ error: `ContactOut API error (${res.status}): ${await res.text()}` });
    }

    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Email enrichment failed" });
  }
}

export async function contactoutSearchCompany(params: {
  name?: string[];
  domain?: string[];
  linkedin_url?: string[];
  location?: string[];
  industries?: string[];
  size?: string[];
  page?: number;
}): Promise<string> {
  if (!contactoutConfig) return JSON.stringify({ error: "ContactOut is not connected" });

  try {
    const res = await fetch(`${CONTACTOUT_API}/v1/company/search`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `ContactOut API error (${res.status}): ${await res.text()}` });
    }

    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Company search failed" });
  }
}

export async function contactoutGetDecisionMakers(params: {
  domain?: string;
  name?: string;
  linkedin_url?: string;
  reveal_info?: boolean;
  page?: number;
}): Promise<string> {
  if (!contactoutConfig) return JSON.stringify({ error: "ContactOut is not connected" });

  try {
    const query = new URLSearchParams();
    if (params.domain) query.set("domain", params.domain);
    if (params.name) query.set("name", params.name);
    if (params.linkedin_url) query.set("linkedin_url", params.linkedin_url);
    if (params.reveal_info) query.set("reveal_info", "true");
    if (params.page) query.set("page", String(params.page));

    const res = await fetch(`${CONTACTOUT_API}/v1/people/decision-makers?${query.toString()}`, {
      headers: headers(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `ContactOut API error (${res.status}): ${await res.text()}` });
    }

    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Decision makers lookup failed" });
  }
}

export async function contactoutVerifyEmail(email: string): Promise<string> {
  if (!contactoutConfig) return JSON.stringify({ error: "ContactOut is not connected" });

  try {
    const res = await fetch(`${CONTACTOUT_API}/v1/email/verify?email=${encodeURIComponent(email)}`, {
      headers: headers(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `ContactOut API error (${res.status}): ${await res.text()}` });
    }

    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Email verification failed" });
  }
}

export async function contactoutGetUsage(): Promise<string> {
  if (!contactoutConfig) return JSON.stringify({ error: "ContactOut is not connected" });

  try {
    const res = await fetch(`${CONTACTOUT_API}/v1/stats`, { headers: headers() });

    if (!res.ok) {
      return JSON.stringify({ error: `ContactOut API error (${res.status}): ${await res.text()}` });
    }

    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get usage stats" });
  }
}
