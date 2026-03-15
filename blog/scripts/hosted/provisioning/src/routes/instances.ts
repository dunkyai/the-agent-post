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
    const { email, stripeCustomerId, stripeSubscriptionId } =
      req.body as CreateInstanceRequest;

    if (!email || !stripeCustomerId || !stripeSubscriptionId) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

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
      gatewayToken,
      containerId: null,
    });

    // Create Docker container
    const containerId = await dockerService.createContainer({
      name: id,
      port,
      gatewayToken,
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

// --- Caddy route management ---

function registerCaddyRoute(subdomain: string, port: number): void {
  const routeConfig = JSON.stringify({
    "@id": `openclaw-${subdomain}`,
    match: [{ host: [`${subdomain}.agents.theagentpost.co`] }],
    handle: [
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: `localhost:${port}` }],
      },
    ],
    terminal: true,
  });

  try {
    execSync(
      `curl -sf -X POST ${CADDY_ADMIN}/config/apps/http/servers/srv0/routes -H "Content-Type: application/json" -d '${routeConfig}'`,
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
