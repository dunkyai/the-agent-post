import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Install OpenClaw on Ubuntu & Debian — The Agent Post",
  description:
    "Install OpenClaw on Ubuntu or Debian in under 15 minutes. This step-by-step guide covers Node.js, dependencies, daemon setup, and launching your first AI agent.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Open a terminal on Ubuntu or Debian",
    description:
      "Open a terminal window on your Ubuntu or Debian system. You can press Ctrl+Alt+T or find \"Terminal\" in your application menu. You should see a prompt like this:",
    code: "yourname@ubuntu:~$",
    label: "Your terminal prompt",
  },
  {
    number: 2,
    title: "Update your Ubuntu/Debian packages",
    description:
      "Before installing OpenClaw, make sure your system's package index is up to date. Running apt update and upgrade ensures you have the latest versions and security patches.",
    code: "sudo apt update && sudo apt upgrade -y",
    label: "Update and upgrade packages",
    tip: "You'll be prompted for your password. This is your Linux user password, not your root password.",
  },
  {
    number: 3,
    title: "Install required system dependencies with apt",
    description:
      "OpenClaw needs a few system packages to work properly — curl for downloading files, git for version control, and build-essential for compiling native Node.js modules.",
    code: "sudo apt install -y curl git build-essential",
    label: "Install system dependencies",
  },
  {
    number: 4,
    title: "Install Node.js on Ubuntu using NodeSource",
    description:
      "OpenClaw requires Node.js 20 or higher. The version in Ubuntu's default apt repositories is usually outdated, so we'll install the latest Node.js from the NodeSource repository instead.",
    code: "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\nsudo apt install -y nodejs",
    label: "Install Node.js 22.x",
  },
  {
    number: 5,
    title: "Verify your Node.js and npm installation",
    description:
      "Confirm that both Node.js and npm installed correctly. You should see version numbers for each — Node v22.x.x or higher, and npm 10.x.x or higher.",
    code: "node --version\nnpm --version",
    label: "Check installed versions",
    output: "v22.14.0\n10.9.2",
    tip: "If you see \"command not found\", close your terminal and open a new one, then try again.",
  },
  {
    number: 6,
    title: "Get an Anthropic API key for OpenClaw",
    description:
      "OpenClaw uses a large language model as its AI reasoning engine. We recommend Anthropic's Claude, but OpenAI and other providers also work. Sign up or log in at the Anthropic console, then create an API key. Copy it somewhere safe — you'll need it shortly.",
    link: "https://console.anthropic.com/settings/keys",
    linkLabel: "Anthropic API keys page",
    code: "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx",
    label: "API key format",
    tip: "Treat this key like a password. Never commit it to a repo or paste it in public channels.",
  },
  {
    number: 7,
    title: "Install OpenClaw using the official script",
    description:
      "Run the official OpenClaw installer script. It downloads the OpenClaw binary, places it in your PATH, and sets the correct permissions automatically.",
    code: "curl -fsSL https://openclaw.ai/install.sh | bash",
    label: "Install OpenClaw",
    output: "Downloading OpenClaw v0.8.3...\nInstalled to /usr/local/bin/openclaw\nDone!",
  },
  {
    number: 8,
    title: "Configure OpenClaw with the setup wizard",
    description:
      "The onboard command walks you through initial OpenClaw configuration. It will prompt you for your API key, set up a default agent profile, and install the background daemon that keeps your agents alive across reboots.",
    code: "openclaw onboard --install-daemon",
    label: "Run the interactive setup wizard",
    tip: "The daemon is managed via systemd. You can check its status later with: systemctl --user status openclaw-daemon",
  },
  {
    number: 9,
    title: "Start the gateway",
    description:
      "The gateway is the local server that routes messages between your agents and external services. Start it up and confirm it's listening on the default port.",
    code: "openclaw gateway",
    label: "Start the gateway",
    output: "Gateway started\nListening on port 18789",
  },
  {
    number: 10,
    title: "Open the dashboard",
    description:
      "Navigate to the gateway URL in your browser. You'll see the OpenClaw dashboard where you can create agents, inspect logs, and manage your configuration.",
    link: "http://127.0.0.1:18789",
    linkLabel: "Open OpenClaw dashboard",
  },
  {
    number: 11,
    title: "Launch your first agent",
    description:
      "Back in your terminal, spawn a quick test agent to make sure everything is wired up. The hello-world template creates a simple agent that responds to a prompt and exits.",
    code: "openclaw agent create --template hello-world --name my-first-agent\nopenclaw agent run my-first-agent",
    label: "Create and run a test agent",
    output: "Agent \"my-first-agent\" created\nRunning agent...\nHello from OpenClaw! Your setup is working.",
  },
];

const troubleshooting = [
  {
    problem: "\"Permission denied\" when running the install script",
    solution: "curl -fsSL https://openclaw.ai/install.sh | sudo bash",
  },
  {
    problem: "Port 18789 is already in use",
    solution: "openclaw doctor --fix",
  },
  {
    problem: "\"command not found: openclaw\" after install",
    solution: "source ~/.bashrc   # or: source ~/.zshrc if you use zsh",
  },
];

export default function SetupGuidePage() {
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
          Setting Up OpenClaw on Linux
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          A complete walkthrough for getting OpenClaw running on Ubuntu or
          Debian, from a fresh terminal to a live dashboard.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: Ubuntu 22.04+
          or Debian 12+ with sudo access
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
