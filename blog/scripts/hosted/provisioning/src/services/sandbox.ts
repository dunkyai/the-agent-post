import { docker } from "./docker";

const SANDBOX_IMAGE = "ghcr.io/dunkyai/openclaw-sandbox:latest";
const SANDBOX_TIMEOUT_MS = 30_000; // 30 seconds
const SANDBOX_MEMORY = 512 * 1024 * 1024; // 512MB
const SANDBOX_CPU_PERIOD = 100000;
const SANDBOX_CPU_QUOTA = 50000; // 0.5 vCPU

// Rate limiting: track executions per instance
const execCounts = new Map<string, { count: number; resetAt: number }>();
const MAX_EXECS_PER_MINUTE = 10;

function checkRateLimit(instanceId: string): void {
  const now = Date.now();
  const entry = execCounts.get(instanceId);

  if (!entry || now > entry.resetAt) {
    execCounts.set(instanceId, { count: 1, resetAt: now + 60_000 });
    return;
  }

  if (entry.count >= MAX_EXECS_PER_MINUTE) {
    throw new Error("Rate limit exceeded: max 10 sandbox executions per minute");
  }

  entry.count++;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export async function executeInSandbox(opts: {
  instanceId: string;
  command: string;
  timeout?: number;
}): Promise<SandboxResult> {
  checkRateLimit(opts.instanceId);

  const timeout = opts.timeout || SANDBOX_TIMEOUT_MS;
  const volumeName = `openclaw-sandbox-${opts.instanceId}`;

  // Determine gVisor availability
  let runtime: string | undefined;
  try {
    const info = await docker.info();
    const runtimes = (info as any).Runtimes || {};
    if (runtimes.runsc) {
      runtime = "runsc";
    }
  } catch {}

  const containerOpts: any = {
    Image: SANDBOX_IMAGE,
    Cmd: ["sh", "-c", opts.command],
    User: "1001:1001",
    WorkingDir: "/workspace",
    AttachStdout: true,
    AttachStderr: true,
    HostConfig: {
      Binds: [`${volumeName}:/workspace:rw`],
      Memory: SANDBOX_MEMORY,
      CpuPeriod: SANDBOX_CPU_PERIOD,
      CpuQuota: SANDBOX_CPU_QUOTA,
      SecurityOpt: ["no-new-privileges:true"],
      CapDrop: ["ALL"],
      NetworkMode: "none",
      Ulimits: [
        { Name: "nofile", Soft: 256, Hard: 512 },
        { Name: "nproc", Soft: 64, Hard: 128 },
      ],
      AutoRemove: true,
    },
  };

  if (runtime) {
    containerOpts.HostConfig.Runtime = runtime;
  }

  const container = await docker.createContainer(containerOpts);

  // Attach to capture output
  const stream = await container.attach({
    stream: true,
    stdout: true,
    stderr: true,
  });

  let stdout = "";
  let stderr = "";

  // Demux the Docker multiplexed stream
  const stdoutStream = new (require("stream").PassThrough)();
  const stderrStream = new (require("stream").PassThrough)();

  stdoutStream.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  stderrStream.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  container.modem.demuxStream(stream, stdoutStream, stderrStream);

  await container.start();

  let timedOut = false;

  try {
    const result = await Promise.race([
      container.wait() as Promise<{ StatusCode: number }>,
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          timedOut = true;
          reject(new Error("timeout"));
        }, timeout)
      ),
    ]);

    return {
      stdout: stdout.slice(0, 50_000), // Cap output size
      stderr: stderr.slice(0, 50_000),
      exitCode: result.StatusCode,
      timedOut: false,
    };
  } catch (err) {
    if (timedOut) {
      try {
        await container.kill();
      } catch {}
      return {
        stdout: stdout.slice(0, 50_000),
        stderr: stderr.slice(0, 50_000),
        exitCode: -1,
        timedOut: true,
      };
    }
    throw err;
  }
}

export async function readSandboxFile(opts: {
  instanceId: string;
  path: string;
}): Promise<string> {
  const result = await executeInSandbox({
    instanceId: opts.instanceId,
    command: `cat ${JSON.stringify(opts.path)}`,
    timeout: 5000,
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `File not found: ${opts.path}`);
  }
  return result.stdout;
}

export async function writeSandboxFile(opts: {
  instanceId: string;
  path: string;
  content: string;
}): Promise<void> {
  // Use a heredoc-style approach to write content
  const escapedContent = opts.content.replace(/'/g, "'\\''");
  const result = await executeInSandbox({
    instanceId: opts.instanceId,
    command: `cat > ${JSON.stringify(opts.path)} << 'OPENCLAW_EOF'\n${opts.content}\nOPENCLAW_EOF`,
    timeout: 5000,
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Failed to write: ${opts.path}`);
  }
}
