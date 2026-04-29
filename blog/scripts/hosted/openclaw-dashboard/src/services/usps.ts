const USPS_API = "https://apis.usps.com";
const USPS_TOKEN_URL = "https://apis.usps.com/oauth2/v3/token";

// Module state
interface UspsConfig {
  client_id: string;
  client_secret: string;
  access_token?: string;
  token_expiry?: string;
}

let uspsConfig: UspsConfig | null = null;

// --- Lifecycle ---

export function startUsps(config: UspsConfig): void {
  uspsConfig = config;
  console.log("USPS connected");
}

export function stopUsps(): void {
  uspsConfig = null;
  console.log("USPS disconnected");
}

export function isUspsRunning(): boolean {
  return uspsConfig !== null;
}

// --- Connection test ---

export async function testUspsConnection(clientId: string, clientSecret: string): Promise<{ success: boolean }> {
  const token = await getAccessToken(clientId, clientSecret);
  if (!token) throw new Error("Failed to authenticate with USPS. Check your Client ID and Client Secret.");
  return { success: true };
}

// --- OAuth token management ---

async function getAccessToken(clientId?: string, clientSecret?: string): Promise<string | null> {
  const id = clientId || uspsConfig?.client_id;
  const secret = clientSecret || uspsConfig?.client_secret;
  if (!id || !secret) return null;

  // Return cached token if still valid
  if (uspsConfig?.access_token && uspsConfig?.token_expiry) {
    const expiry = new Date(uspsConfig.token_expiry);
    if (expiry.getTime() - Date.now() > 60 * 1000) {
      return uspsConfig.access_token;
    }
  }

  try {
    const res = await fetch(USPS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: id,
        client_secret: secret,
      }),
    });

    if (!res.ok) {
      console.error(`USPS token error (${res.status}): ${await res.text()}`);
      return null;
    }

    const data: any = await res.json();
    if (uspsConfig) {
      uspsConfig.access_token = data.access_token;
      uspsConfig.token_expiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
    }
    return data.access_token;
  } catch (err) {
    console.error("USPS token error:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) throw new Error("USPS is not connected or authentication failed");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// --- API wrappers ---

export async function uspsCheckAvailability(params: {
  street: string;
  city: string;
  state: string;
  zip: string;
  pickup_date?: string;
}): Promise<string> {
  if (!uspsConfig) return JSON.stringify({ error: "USPS is not connected" });
  try {
    const query = new URLSearchParams({
      streetAddress: params.street,
      city: params.city,
      state: params.state,
      ZIPCode: params.zip,
    });
    if (params.pickup_date) query.set("pickupDate", params.pickup_date);

    const res = await fetch(`${USPS_API}/pickup/v3/carrier-pickup/check-availability?${query}`, {
      headers: await authHeaders(),
    });

    if (!res.ok) return JSON.stringify({ error: `USPS API error (${res.status}): ${await res.text()}` });
    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to check availability" });
  }
}

export async function uspsSchedulePickup(params: {
  first_name: string;
  last_name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email?: string;
  pickup_date: string;
  packages: { service_type: string; count: number }[];
  estimated_weight: number;
  pickup_location?: string;
  special_instructions?: string;
}): Promise<string> {
  if (!uspsConfig) return JSON.stringify({ error: "USPS is not connected" });
  try {
    const body: any = {
      pickupDate: params.pickup_date,
      pickupAddress: {
        firstName: params.first_name,
        lastName: params.last_name,
        streetAddress: params.street,
        city: params.city,
        state: params.state,
        ZIPCode: params.zip,
      },
      packages: params.packages.map(p => ({
        packageType: p.service_type,
        packageCount: String(p.count),
      })),
      estimatedWeight: String(params.estimated_weight),
      pickupLocation: { packageLocation: params.pickup_location || "Front Door" },
      contactInfo: {
        phone: params.phone.replace(/\D/g, ""),
        email: params.email || undefined,
      },
    };

    if (params.special_instructions) {
      body.pickupLocation.specialInstructions = params.special_instructions;
    }

    const res = await fetch(`${USPS_API}/pickup/v3/carrier-pickup`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) return JSON.stringify({ error: `USPS API error (${res.status}): ${await res.text()}` });

    const data: any = await res.json();
    return JSON.stringify({
      success: true,
      confirmation_number: data.confirmationNumber,
      pickup_date: data.pickupDate,
      address: `${params.street}, ${params.city}, ${params.state} ${params.zip}`,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to schedule pickup" });
  }
}

export async function uspsGetPickup(confirmationNumber: string): Promise<string> {
  if (!uspsConfig) return JSON.stringify({ error: "USPS is not connected" });
  try {
    const res = await fetch(`${USPS_API}/pickup/v3/carrier-pickup/${encodeURIComponent(confirmationNumber)}`, {
      headers: await authHeaders(),
    });
    if (!res.ok) return JSON.stringify({ error: `USPS API error (${res.status}): ${await res.text()}` });
    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get pickup details" });
  }
}

export async function uspsCancelPickup(confirmationNumber: string): Promise<string> {
  if (!uspsConfig) return JSON.stringify({ error: "USPS is not connected" });
  try {
    const res = await fetch(`${USPS_API}/pickup/v3/carrier-pickup/${encodeURIComponent(confirmationNumber)}`, {
      method: "DELETE",
      headers: await authHeaders(),
    });
    if (!res.ok) return JSON.stringify({ error: `USPS API error (${res.status}): ${await res.text()}` });
    return JSON.stringify({ success: true, cancelled: confirmationNumber });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to cancel pickup" });
  }
}

export async function uspsUpdatePickup(params: {
  confirmation_number: string;
  first_name: string;
  last_name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email?: string;
  pickup_date: string;
  packages: { service_type: string; count: number }[];
  estimated_weight: number;
  pickup_location?: string;
  special_instructions?: string;
}): Promise<string> {
  if (!uspsConfig) return JSON.stringify({ error: "USPS is not connected" });
  try {
    const body: any = {
      confirmationNumber: params.confirmation_number,
      pickupDate: params.pickup_date,
      pickupAddress: {
        firstName: params.first_name,
        lastName: params.last_name,
        streetAddress: params.street,
        city: params.city,
        state: params.state,
        ZIPCode: params.zip,
      },
      packages: params.packages.map(p => ({
        packageType: p.service_type,
        packageCount: String(p.count),
      })),
      estimatedWeight: String(params.estimated_weight),
      pickupLocation: { packageLocation: params.pickup_location || "Front Door" },
      contactInfo: {
        phone: params.phone.replace(/\D/g, ""),
        email: params.email || undefined,
      },
    };

    if (params.special_instructions) {
      body.pickupLocation.specialInstructions = params.special_instructions;
    }

    const res = await fetch(`${USPS_API}/pickup/v3/carrier-pickup/${encodeURIComponent(params.confirmation_number)}`, {
      method: "PUT",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) return JSON.stringify({ error: `USPS API error (${res.status}): ${await res.text()}` });

    const data: any = await res.json();
    return JSON.stringify({
      success: true,
      confirmation_number: data.confirmationNumber,
      pickup_date: data.pickupDate,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to update pickup" });
  }
}
