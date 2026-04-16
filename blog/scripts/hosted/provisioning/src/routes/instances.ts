import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { execSync } from "child_process";
import * as store from "../services/store";
import * as dockerService from "../services/docker";
import * as sandboxService from "../services/sandbox";
import * as browserService from "../services/browser";
import { allocatePort } from "../services/port-manager";
import type { CreateInstanceRequest } from "../types";

const router = Router();

const CADDY_ADMIN = "http://localhost:2019";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";

// POST /instances — create a new instance
router.post("/", async (req, res) => {
  try {
    const { email, stripeCustomerId, stripeSubscriptionId, plan } =
      req.body as CreateInstanceRequest;

    if (!email || !stripeCustomerId || !stripeSubscriptionId) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const instancePlan = plan === "pro" ? "pro" : "standard";
    const messageLimit = instancePlan === "pro" ? 1000 : 250;

    const id = uuidv4().slice(0, 8);
    const subdomain = id;
    const port = allocatePort();
    const gatewayToken = uuidv4();

    // Create DB record
    const instance = store.createInstance({
      id,
      email,
      subdomain,
      port,
      status: "provisioning",
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus: "active",
      gatewayToken,
      containerId: null,
      plan: instancePlan,
      messageLimit,
    });

    // Create Docker container
    const containerId = await dockerService.createContainer({
      name: id,
      port,
      gatewayToken,
      plan: instancePlan,
      messageLimit,
    });

    // Register Caddy route
    registerCaddyRoute(subdomain, port);

    // Update instance with container ID and status
    const updated = store.updateInstance(id, {
      containerId,
      status: "running",
    });

    console.log(`Instance created: ${id} for ${email} on port ${port}`);
    res.status(201).json(updated);
  } catch (err) {
    console.error("Failed to create instance:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to create instance",
    });
  }
});

// GET /instances — list all instances
router.get("/", (_req, res) => {
  try {
    const instances = store.listInstances();
    res.json(instances);
  } catch (err) {
    console.error("Failed to list instances:", err);
    res.status(500).json({ error: "Failed to list instances" });
  }
});

// GET /instances/:id — get single instance
router.get("/:id", (req, res) => {
  try {
    const instance = store.getInstance(req.params.id);
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }
    res.json(instance);
  } catch (err) {
    console.error("Failed to get instance:", err);
    res.status(500).json({ error: "Failed to get instance" });
  }
});

// POST /instances/:id/suspend — suspend instance
router.post("/:id/suspend", async (req, res) => {
  try {
    const instance = store.getInstance(req.params.id);
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    if (instance.containerId) {
      await dockerService.stopContainer(instance.containerId);
    }

    const updated = store.updateInstance(instance.id, { status: "suspended" });
    console.log(`Instance suspended: ${instance.id}`);
    res.json(updated);
  } catch (err) {
    console.error("Failed to suspend instance:", err);
    res.status(500).json({ error: "Failed to suspend instance" });
  }
});

// POST /instances/:id/resume — resume instance
router.post("/:id/resume", async (req, res) => {
  try {
    const instance = store.getInstance(req.params.id);
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    if (instance.containerId) {
      await dockerService.startContainer(instance.containerId);
    }

    const updated = store.updateInstance(instance.id, { status: "running" });
    console.log(`Instance resumed: ${instance.id}`);
    res.json(updated);
  } catch (err) {
    console.error("Failed to resume instance:", err);
    res.status(500).json({ error: "Failed to resume instance" });
  }
});

// DELETE /instances/:id — delete instance
router.delete("/:id", async (req, res) => {
  try {
    const instance = store.getInstance(req.params.id);
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    if (instance.containerId) {
      await dockerService.removeContainer(instance.containerId, instance.id);
    }

    deregisterCaddyRoute(instance.subdomain);
    store.deleteSlackInstallationsByInstance(instance.id);
    store.deleteInstance(instance.id);

    console.log(`Instance deleted: ${instance.id}`);
    res.json({ deleted: true });
  } catch (err) {
    console.error("Failed to delete instance:", err);
    res.status(500).json({ error: "Failed to delete instance" });
  }
});

// POST /instances/:id/sandbox/exec — execute command in sandbox
router.post("/:id/sandbox/exec", async (req, res) => {
  try {
    const instance = store.getInstance(req.params.id);
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    // Auth: verify the request comes from the correct agent
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token !== instance.gatewayToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { command, action, path, content } = req.body;

    if (action === "read_file" && path) {
      const fileContent = await sandboxService.readSandboxFile({
        instanceId: instance.id,
        path,
      });
      res.json({ stdout: fileContent, stderr: "", exitCode: 0, timedOut: false });
      return;
    }

    if (action === "write_file" && path && content !== undefined) {
      await sandboxService.writeSandboxFile({
        instanceId: instance.id,
        path,
        content,
      });
      res.json({ stdout: "File written", stderr: "", exitCode: 0, timedOut: false });
      return;
    }

    if (!command) {
      res.status(400).json({ error: "command is required" });
      return;
    }

    const result = await sandboxService.executeInSandbox({
      instanceId: instance.id,
      command,
      timeout: 30000,
    });

    res.json(result);
  } catch (err) {
    console.error("Sandbox exec error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Sandbox execution failed",
    });
  }
});

// POST /instances/:id/browser/:action — forward browser action
router.post("/:id/browser/:action", async (req, res) => {
  try {
    const instance = store.getInstance(req.params.id);
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    // Auth: verify the request comes from the correct agent
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token !== instance.gatewayToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await browserService.forwardBrowserAction(
      instance.id,
      req.params.action,
      req.body || {}
    );

    res.json(result);
  } catch (err) {
    console.error("Browser action error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Browser action failed",
    });
  }
});

// POST /instances/:id/magic-link — instance requests a magic link for its owner
router.post("/:id/magic-link", async (req, res) => {
  try {
    const instance = store.getInstance(req.params.id);
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    // Auth: verify the request comes from the correct agent
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token !== instance.gatewayToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { email } = req.body;
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    // Rate limit: max 3 magic links per instance per 15 minutes
    const recentCount = store.countRecentMagicLinksForInstance(instance.id, 15 * 60 * 1000);
    if (recentCount >= 3) {
      // Still return success to prevent enumeration
      res.json({ message: "If you have an account, you will receive an email from us with your magic link." });
      return;
    }

    // Only send if email matches the instance owner
    if (email.trim().toLowerCase() === instance.email.toLowerCase()) {
      const magicToken = store.createMagicLinkToken(instance.id);
      const magicLink = `https://api.dunky.ai/auth/magic-link?token=${magicToken}`;

      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Dunky <noreply@dunky.ai>",
            to: instance.email,
            subject: "Sign in to your OpenClaw dashboard",
            html: magicLinkEmailHtml(magicLink),
          }),
        });
        console.log(`Magic link sent to ${instance.email} for instance ${instance.id}`);
      } else {
        console.error("RESEND_API_KEY not set — cannot send magic link email");
      }
    }

    // Always return success to prevent email enumeration
    res.json({ message: "If you have an account, you will receive an email from us with your magic link." });
  } catch (err) {
    console.error("Magic link error:", err);
    res.status(500).json({ error: "Failed to send magic link" });
  }
});

// GET /instances/:id/plan — get plan info for this instance
router.get("/:id/plan", (req, res) => {
  try {
    const instance = store.getInstance(req.params.id);
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token !== instance.gatewayToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    res.json({ plan: instance.plan, message_limit: instance.messageLimit });
  } catch (err) {
    console.error("Failed to get plan:", err);
    res.status(500).json({ error: "Failed to get plan" });
  }
});

// GET /instances/:id/upgrade-url — create Stripe billing portal session
router.get("/:id/upgrade-url", async (req, res) => {
  try {
    const instance = store.getInstance(req.params.id);
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token !== instance.gatewayToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      res.status(500).json({ error: "Stripe not configured" });
      return;
    }

    const returnUrl = `https://${instance.subdomain}.dunky.ai/settings`;

    const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        customer: instance.stripeCustomerId,
        return_url: returnUrl,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[stripe] Billing portal error:", err);
      res.status(500).json({ error: "Failed to create billing portal session" });
      return;
    }

    const session = await response.json() as { url: string };
    res.json({ url: session.url });
  } catch (err) {
    console.error("Failed to create upgrade URL:", err);
    res.status(500).json({ error: "Failed to create upgrade URL" });
  }
});

// POST /instances/:id/verify-session-code — instance verifies callback code
router.post("/:id/verify-session-code", (req, res) => {
  try {
    const instance = store.getInstance(req.params.id);
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    // Auth: verify the request comes from the correct agent
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token !== instance.gatewayToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { code } = req.body;
    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "Code is required" });
      return;
    }

    const valid = store.verifySessionCode(instance.id, code);
    if (!valid) {
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    res.json({ valid: true });
  } catch (err) {
    console.error("Verify session code error:", err);
    res.status(500).json({ error: "Verification failed" });
  }
});

function magicLinkEmailHtml(link: string): string {
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #1a1a1a; font-size: 20px; margin-bottom: 16px;">Sign in to your OpenClaw dashboard</h2>
  <p style="color: #444; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">Click the button below to sign in. This link can only be used once and expires in 24 hours.</p>
  <a href="${link}" style="display: inline-block; background: #6c5ce7; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 15px; font-weight: 500;">Sign in to OpenClaw</a>
  <p style="color: #888; font-size: 13px; margin-top: 32px; line-height: 1.5;">If you didn't request this link, you can safely ignore this email.</p>
  <p style="color: #bbb; font-size: 12px; margin-top: 24px;">— Dunky</p>
</div>`;
}

// --- Caddy route management ---

function registerCaddyRoute(subdomain: string, port: number): void {
  // First, try to delete any existing route with the same ID (idempotent)
  try {
    execSync(`curl -sf -X DELETE ${CADDY_ADMIN}/id/openclaw-${subdomain}`, { timeout: 5000 });
  } catch {}

  const routeConfig = JSON.stringify({
    "@id": `openclaw-${subdomain}`,
    match: [{ host: [`${subdomain}.dunky.ai`] }],
    handle: [
      {
        handler: "subroute",
        routes: [
          {
            handle: [
              {
                handler: "reverse_proxy",
                upstreams: [{ dial: `localhost:${port}` }],
              },
            ],
          },
        ],
      },
    ],
    terminal: true,
  });

  // Find the wildcard *.dunky.ai catch-all route index so we insert before it
  let insertIdx = 0;
  try {
    const routesJson = execSync(
      `curl -sf ${CADDY_ADMIN}/config/apps/http/servers/srv0/routes`,
      { timeout: 5000 }
    ).toString();
    const routes = JSON.parse(routesJson);
    for (let i = 0; i < routes.length; i++) {
      const hosts = routes[i]?.match?.[0]?.host || [];
      if (hosts.includes("*.dunky.ai")) {
        insertIdx = i;
        break;
      }
    }
  } catch {}

  try {
    execSync(
      `curl -sf -X POST ${CADDY_ADMIN}/config/apps/http/servers/srv0/routes/${insertIdx} -H "Content-Type: application/json" -d '${routeConfig}'`,
      { timeout: 5000 }
    );
  } catch (err) {
    throw new Error(`Caddy route registration failed for ${subdomain}`);
  }
}

function deregisterCaddyRoute(subdomain: string): void {
  try {
    execSync(
      `curl -sf -X DELETE ${CADDY_ADMIN}/id/openclaw-${subdomain}`,
      { timeout: 5000 }
    );
  } catch {
    // Ignore — route may not exist
  }
}

export default router;
