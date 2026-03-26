export interface Instance {
  id: string;
  email: string;
  subdomain: string;
  port: number;
  status: "provisioning" | "running" | "suspended" | "deleted";
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscriptionStatus: "active" | "past_due" | "canceled" | "unpaid";
  gatewayToken: string;
  containerId: string | null;
  plan: "standard" | "pro";
  messageLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInstanceRequest {
  email: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  plan?: "standard" | "pro";
}
