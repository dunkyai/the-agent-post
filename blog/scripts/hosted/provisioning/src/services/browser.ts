import { docker } from "./docker";

const BROWSER_IMAGE = "openclaw-browser:latest";
const BROWSER_CONTAINER_NAME = "openclaw-browser";
const BROWSER_PORT = 3600;
const BROWSER_SERVICE_SECRET = process.env.BROWSER_SERVICE_SECRET || "";

export async function ensureBrowserService(): Promise<void> {
  try {
    const container = docker.getContainer(BROWSER_CONTAINER_NAME);
    const info = await container.inspect();

    if (info.State.Status !== "running") {
      console.log("Browser service container exists but not running, starting...");
      await container.start();
    }
    console.log("Browser service is running");
  } catch {
    // Container doesn't exist, create it
    console.log("Creating browser service container...");
    await createBrowserContainer();
    console.log("Browser service container created and started");
  }
}

async function createBrowserContainer(): Promise<void> {
  const container = await docker.createContainer({
    Image: BROWSER_IMAGE,
    name: BROWSER_CONTAINER_NAME,
    Env: [
      `PORT=${BROWSER_PORT}`,
      `BROWSER_SERVICE_SECRET=${BROWSER_SERVICE_SECRET}`,
      `MAX_BROWSERS=5`,
      `NODE_ENV=production`,
    ],
    ExposedPorts: { [`${BROWSER_PORT}/tcp`]: {} },
    HostConfig: {
      PortBindings: {
        [`${BROWSER_PORT}/tcp`]: [{ HostIp: "127.0.0.1", HostPort: String(BROWSER_PORT) }],
      },
      Memory: 3 * 1024 * 1024 * 1024, // 3GB
      CpuPeriod: 100000,
      CpuQuota: 200000, // 2 vCPUs
      RestartPolicy: { Name: "unless-stopped" },
      // SHM size needed for Chromium
      ShmSize: 512 * 1024 * 1024, // 512MB
    },
  });

  await container.start();
}

export async function forwardBrowserAction(
  instanceId: string,
  action: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const url = `http://127.0.0.1:${BROWSER_PORT}/browser/${instanceId}/${action}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BROWSER_SERVICE_SECRET}`,
    },
    body: JSON.stringify(params),
  });

  const data: any = await resp.json();

  if (!resp.ok) {
    throw new Error(data.error || `Browser action failed: ${resp.status}`);
  }

  return data;
}
