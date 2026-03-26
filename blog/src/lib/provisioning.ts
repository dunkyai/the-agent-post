const PROVISIONING_API_URL = process.env.PROVISIONING_API_URL;
const PROVISIONING_API_SECRET = process.env.PROVISIONING_API_SECRET;

interface Instance {
  id: string;
  email: string;
  subdomain: string;
  port: number;
  status: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  gatewayToken: string;
  createdAt: string;
}

interface CreateInstancePayload {
  email: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  plan?: "standard" | "pro";
}

async function provisioningFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  if (!PROVISIONING_API_URL || !PROVISIONING_API_SECRET) {
    throw new Error("Provisioning API not configured");
  }

  return fetch(`${PROVISIONING_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PROVISIONING_API_SECRET}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

export async function createInstance(
  payload: CreateInstancePayload
): Promise<Instance> {
  const res = await provisioningFetch("/instances", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to create instance");
  }

  return res.json();
}

export async function suspendInstance(id: string): Promise<void> {
  const res = await provisioningFetch(`/instances/${id}/suspend`, {
    method: "POST",
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to suspend instance");
  }
}

export async function resumeInstance(id: string): Promise<void> {
  const res = await provisioningFetch(`/instances/${id}/resume`, {
    method: "POST",
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to resume instance");
  }
}

export async function deleteInstance(id: string): Promise<void> {
  const res = await provisioningFetch(`/instances/${id}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to delete instance");
  }
}

export async function listInstances(): Promise<Instance[]> {
  const res = await provisioningFetch("/instances");

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to list instances");
  }

  return res.json();
}

export async function getInstanceBySubscription(
  subscriptionId: string
): Promise<Instance | null> {
  const instances = await listInstances();
  return (
    instances.find((i) => i.stripeSubscriptionId === subscriptionId) || null
  );
}
