import * as store from "./store";
import { stopContainer, startContainer } from "./docker";
import type { Instance } from "../types";

/**
 * Suspend an instance due to billing failure.
 * Only suspends if currently running. Data stays intact.
 */
export async function suspendForBilling(instance: Instance): Promise<void> {
  if (instance.status !== "running") return;

  if (instance.containerId) {
    await stopContainer(instance.containerId);
  }

  store.updateInstance(instance.id, { status: "suspended" });
  console.log(`[billing] Instance ${instance.id} suspended (subscription: ${instance.subscriptionStatus})`);
}

/**
 * Resume an instance after billing is resolved.
 * Only resumes if the instance was suspended AND had a non-active subscription
 * (i.e., it was a billing suspension, not a manual one).
 */
export async function resumeFromBilling(instance: Instance): Promise<void> {
  if (instance.status !== "suspended") return;
  // Don't auto-resume manually suspended instances
  if (instance.subscriptionStatus === "active") return;

  if (instance.containerId) {
    await startContainer(instance.containerId);
  }

  store.updateInstance(instance.id, {
    status: "running",
    subscriptionStatus: "active",
  });
  console.log(`[billing] Instance ${instance.id} resumed after payment`);
}

/**
 * Periodic safety net: find any running instances with bad subscription status
 * and suspend them. Catches cases where webhooks were missed.
 */
export async function enforceBillingActions(): Promise<void> {
  const pending = store.getBillingSuspendable();
  for (const instance of pending) {
    try {
      await suspendForBilling(instance);
    } catch (err) {
      console.error(`[billing] Failed to suspend instance ${instance.id}:`, err);
    }
  }
  if (pending.length > 0) {
    console.log(`[billing] Enforcement: suspended ${pending.length} instance(s)`);
  }
}
