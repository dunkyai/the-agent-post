import Dockerode from "dockerode";

const docker = new Dockerode({ socketPath: "/var/run/docker.sock" });

const IMAGE = "ghcr.io/dunkyai/openclaw:latest";
const MEMORY_LIMIT = 1024 * 1024 * 1024; // 1GB
const CPU_PERIOD = 100000;
const CPU_QUOTA = 100000; // 1 vCPU

export async function createContainer(opts: {
  name: string;
  port: number;
  gatewayToken: string;
}): Promise<string> {
  const container = await docker.createContainer({
    Image: IMAGE,
    name: `openclaw-${opts.name}`,
    Env: [
      `PORT=3000`,
      `GATEWAY_TOKEN=${opts.gatewayToken}`,
    ],
    ExposedPorts: { "3000/tcp": {} },
    HostConfig: {
      Binds: [`openclaw-data-${opts.name}:/data`],
      PortBindings: {
        "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: String(opts.port) }],
      },
      Memory: MEMORY_LIMIT,
      CpuPeriod: CPU_PERIOD,
      CpuQuota: CPU_QUOTA,
      RestartPolicy: { Name: "unless-stopped" },
      SecurityOpt: ["no-new-privileges:true"],
      CapDrop: [
        "ALL",
      ],
      CapAdd: [
        "NET_BIND_SERVICE",
      ],
    },
  });

  await container.start();
  return container.id;
}

export async function stopContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  try {
    await container.stop();
  } catch (err: unknown) {
    // Container might already be stopped
    if (err instanceof Error && !err.message.includes("not running")) {
      throw err;
    }
  }
}

export async function startContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  await container.start();
}

export async function removeContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  try {
    await container.stop();
  } catch {
    // Ignore — might already be stopped
  }
  await container.remove({ force: true });
}

export async function getContainerStatus(
  containerId: string
): Promise<string> {
  const container = docker.getContainer(containerId);
  const info = await container.inspect();
  return info.State.Status;
}
