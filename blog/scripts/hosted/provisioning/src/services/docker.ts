import Dockerode from "dockerode";

const docker = new Dockerode({ socketPath: "/var/run/docker.sock" });

const IMAGE = "ghcr.io/dunkyai/openclaw:latest";
const MEMORY_LIMIT = 1024 * 1024 * 1024; // 1GB
const CPU_PERIOD = 100000;
const CPU_QUOTA = 100000; // 1 vCPU

export async function createNetwork(name: string): Promise<string> {
  const network = await docker.createNetwork({
    Name: `openclaw-net-${name}`,
    Driver: "bridge",
    Internal: false, // allows egress to internet (for API calls)
    Options: {
      "com.docker.network.bridge.enable_icc": "false",
    },
  });
  return network.id;
}

export async function removeNetwork(name: string): Promise<void> {
  try {
    const network = docker.getNetwork(`openclaw-net-${name}`);
    await network.remove();
  } catch {
    // Network may not exist
  }
}

export async function createContainer(opts: {
  name: string;
  port: number;
  gatewayToken: string;
}): Promise<string> {
  // Create isolated network for this instance
  await createNetwork(opts.name);

  const container = await docker.createContainer({
    Image: IMAGE,
    name: `openclaw-${opts.name}`,
    Env: [
      `PORT=3000`,
      `GATEWAY_TOKEN=${opts.gatewayToken}`,
      `INSTANCE_ID=${opts.name}`,
      `PROVISIONING_URL=http://host.docker.internal:3500`,
      `NODE_ENV=production`,
      `GOOGLE_CLIENT_ID=${process.env.GOOGLE_CLIENT_ID || ""}`,
      `GOOGLE_CLIENT_SECRET=${process.env.GOOGLE_CLIENT_SECRET || ""}`,
      `SLACK_CLIENT_ID=${process.env.SLACK_CLIENT_ID || ""}`,
      `TWITTER_CLIENT_ID=${process.env.TWITTER_CLIENT_ID || ""}`,
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
      CapDrop: ["ALL"],
      ReadonlyRootfs: true,
      Tmpfs: {
        "/tmp": "rw,noexec,nosuid,size=67108864",
        "/run": "rw,noexec,nosuid,size=8388608",
      },
      Ulimits: [
        { Name: "nofile", Soft: 1024, Hard: 2048 },
        { Name: "nproc", Soft: 256, Hard: 512 },
      ],
      NetworkMode: `openclaw-net-${opts.name}`,
      ExtraHosts: ["host.docker.internal:host-gateway"],
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

export async function removeContainer(
  containerId: string,
  instanceName?: string
): Promise<void> {
  const container = docker.getContainer(containerId);
  try {
    await container.stop();
  } catch {
    // Ignore — might already be stopped
  }
  await container.remove({ force: true });
  if (instanceName) {
    await removeNetwork(instanceName);
  }
}

export async function getContainerStatus(
  containerId: string
): Promise<string> {
  const container = docker.getContainer(containerId);
  const info = await container.inspect();
  return info.State.Status;
}

export { docker };
