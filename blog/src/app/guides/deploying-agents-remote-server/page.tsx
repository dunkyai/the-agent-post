import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Deploy OpenClaw Agents to a Remote Server — The Agent Post",
  description:
    "Learn how to deploy OpenClaw agents to a remote Linux server in 15 minutes. Covers packaging, SCP transfer, systemd setup, and persistent uptime.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Test your OpenClaw agent locally before deploying",
    description:
      "Before deploying anywhere, confirm your OpenClaw agent works on your own machine. Start the gateway and run the agent locally to verify there are no configuration errors or missing dependencies.",
    code: "openclaw gateway &\nopenclaw agent run my-agent",
    label: "Test your agent locally",
    tip: "Fix any issues locally first. Debugging on a remote server is always harder.",
  },
  {
    number: 2,
    title: "Package your agent into a .claw bundle",
    description:
      "OpenClaw bundles package your agent code, configuration, and dependency manifest into a single portable archive. The resulting .claw file is what you'll transfer to your remote server.",
    code: "openclaw agent pack my-agent",
    label: "Package the agent",
    output: "Packing agent \"my-agent\"...\nIncluding 3 tools, 1 prompt template\nBundle created: my-agent-1.0.0.claw (2.4 MB)",
  },
  {
    number: 3,
    title: "Provision a remote Linux server or VPS",
    description:
      "You'll need a Linux server or VPS with at least 1 GB of RAM and a public IP address. Any major cloud provider works — AWS EC2, DigitalOcean, Hetzner, etc. Make sure you have SSH access and the server is running Ubuntu 22.04 or later.",
    code: "ssh root@your-server-ip",
    label: "SSH into your server",
  },
  {
    number: 4,
    title: "Install Node.js on Ubuntu via NodeSource",
    description:
      "OpenClaw requires Node.js 20 or higher. The fastest way to install it on Ubuntu is through the NodeSource repository. Run these commands on your remote server to add the repo and install Node.",
    code: "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\nsudo apt-get install -y nodejs",
    label: "Install Node.js on Ubuntu",
  },
  {
    number: 5,
    title: "Install OpenClaw on the remote server",
    description:
      "Run the same OpenClaw installer you used on your local machine. On a headless Linux server, pass the --headless flag to skip the interactive prompts and use sensible defaults.",
    code: "curl -fsSL https://openclaw.ai/install.sh | bash -s -- --headless",
    label: "Install OpenClaw in headless mode",
    output: "Installing OpenClaw v0.9.3...\nDependencies resolved\nOpenClaw installed to /usr/local/bin/openclaw",
  },
  {
    number: 6,
    title: "Transfer the agent bundle to the server via SCP",
    description:
      "From your local machine, use SCP to securely copy the .claw bundle to your remote server. You can place it anywhere, but the home directory works fine.",
    code: "scp my-agent-1.0.0.claw root@your-server-ip:~/",
    label: "Copy the bundle to your server",
  },
  {
    number: 7,
    title: "Set your LLM API key as an environment variable",
    description:
      "Your agent needs access to an LLM provider like Anthropic or OpenAI. On the remote server, set your API key as an environment variable. Add it to your shell profile so it persists across reboots.",
    code: "echo 'export ANTHROPIC_API_KEY=\"sk-ant-xxxxxxxx\"' >> ~/.bashrc\nsource ~/.bashrc",
    label: "Set the API key",
    tip: "Never hardcode API keys into agent configs. Always use environment variables.",
  },
  {
    number: 8,
    title: "Deploy and start the agent on the server",
    description:
      "Use the deploy command to unpack the bundle, install its dependencies, and register the agent with the local OpenClaw runtime. The --start flag launches the agent immediately after deployment.",
    code: "openclaw agent deploy my-agent-1.0.0.claw --start",
    label: "Deploy and start the agent",
    output: "Unpacking my-agent-1.0.0.claw...\nInstalling dependencies...\nRegistering agent \"my-agent\"\nAgent started (PID 4829)",
  },
  {
    number: 9,
    title: "Enable the daemon for persistent uptime",
    description:
      "By default, agents stop if the SSH session ends. The OpenClaw daemon installs a systemd service that keeps your agents running in the background and restarts them automatically if they crash.",
    code: "openclaw daemon install\nsudo systemctl enable openclaw",
    label: "Install and enable the daemon",
  },
  {
    number: 10,
    title: "Verify the agent is running",
    description:
      "Check the status of all deployed agents. You should see your agent listed with a \"running\" status and its uptime counter ticking.",
    code: "openclaw agent status",
    label: "Check agent status",
    output: "AGENT        STATUS    UPTIME     PID\nmy-agent     running   2m 14s     4829",
  },
  {
    number: 11,
    title: "Tail the logs",
    description:
      "Keep an eye on your agent's behavior by streaming its logs. This is especially useful right after deployment to catch any runtime errors. Press Ctrl+C to stop watching.",
    code: "openclaw agent logs my-agent --follow",
    label: "Stream agent logs",
    tip: "Logs are stored in ~/.openclaw/logs/ and rotated automatically after 50 MB.",
  },
];

const troubleshooting = [
  {
    problem: "\"Connection refused\" when SSHing into the server",
    solution:
      "Make sure the server's firewall allows port 22. On Ubuntu:\nsudo ufw allow ssh && sudo ufw enable",
  },
  {
    problem: "Agent deploys but immediately exits",
    solution:
      "Check the logs for missing environment variables or invalid config:\nopenclaw agent logs my-agent --lines 50",
  },
  {
    problem: "\"permission denied\" when installing the daemon",
    solution:
      "The daemon installer needs root access. Run with sudo:\nsudo openclaw daemon install",
  },
];

export default function DeployingAgentsRemoteServerGuidePage() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center">
        <Link
          href="/guides"
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-accent transition-colors mb-8"
        >
          &larr; All Guides
        </Link>

        <h1 className="font-serif text-4xl sm:text-5xl font-black tracking-tight leading-tight mb-4">
          Deploying OpenClaw Agents to a Remote Server
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Package your agent, transfer it to a Linux server, and keep it
          running with persistent uptime and automatic restarts.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: a working
          local agent &amp; SSH access to a Linux server
        </p>

        <hr className="section-rule mb-10" />
      </div>

      <div className="space-y-10">
        {steps.map((step) => (
          <section key={step.number} id={`step-${step.number}`}>
            <div className="flex items-baseline gap-3 mb-3">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-accent text-white text-sm font-bold flex items-center justify-center">
                {step.number}
              </span>
              <h2 className="font-serif text-xl font-bold">{step.title}</h2>
            </div>

            <div className="ml-11">
              <p className="text-text-secondary leading-relaxed mb-4">
                {step.description}
              </p>

              {step.link && (
                <a
                  href={step.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-accent hover:underline font-semibold text-sm mb-4"
                >
                  {step.linkLabel || step.link} &rarr;
                </a>
              )}

              {step.code && (
                <div className="bg-tag-bg rounded px-4 py-3 mb-3">
                  {step.label && (
                    <p className="text-xs text-text-secondary mb-1">
                      {step.label}
                    </p>
                  )}
                  <pre className="text-sm font-mono bg-background rounded p-3 overflow-x-auto whitespace-pre-wrap">
                    {step.code}
                  </pre>
                </div>
              )}

              {step.output && (
                <div className="bg-tag-bg rounded px-4 py-3 mb-3">
                  <p className="text-xs text-text-secondary mb-1">
                    Expected output
                  </p>
                  <pre className="text-sm font-mono bg-background rounded p-3 overflow-x-auto whitespace-pre-wrap text-green-600 dark:text-green-400">
                    {step.output}
                  </pre>
                </div>
              )}

              {step.tip && (
                <p className="text-sm text-text-secondary italic">
                  Tip: {step.tip}
                </p>
              )}
            </div>
          </section>
        ))}
      </div>

      <hr className="section-rule my-10" />

      <section className="mb-10">
        <h2 className="font-serif text-2xl font-bold mb-6">Troubleshooting</h2>
        <div className="space-y-4">
          {troubleshooting.map((item) => (
            <div key={item.problem} className="bg-tag-bg rounded px-4 py-3">
              <p className="text-sm font-semibold mb-1">{item.problem}</p>
              <pre className="text-sm font-mono bg-background rounded p-2 overflow-x-auto">
                {item.solution}
              </pre>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-16 text-center">
        <hr className="masthead-rule mb-6" />
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-accent hover:underline font-semibold"
        >
          &larr; Return to front page
        </Link>
      </footer>
    </div>
  );
}
