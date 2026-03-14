export interface Instance {
  id: string;
  email: string;
  subdomain: string;
  port: number;
  status: "provisioning" | "running" | "suspended" | "deleted";
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  gatewayToken: string;
  containerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInstanceRequest {
  email: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}
