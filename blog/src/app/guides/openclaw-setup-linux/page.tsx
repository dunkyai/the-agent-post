import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Install OpenClaw on Linux — The Agent Post",
  description:
    "Install OpenClaw on Ubuntu or Debian with this beginner-friendly guide. Set up Node.js, configure your API key, and launch your first AI agent in minutes.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Open a terminal on Ubuntu or Debian",
    description:
      "Open a Linux terminal window. You can press Ctrl+Alt+T or search for \"Terminal\" in your application menu. You'll see a command prompt that looks something like this:",
    code: "yourname@ubuntu:~$",
    label: "Your terminal prompt",
  },
  {
    number: 2,
    title: "Update your system packages with apt",
    description:
      "Before installing anything, make sure your system's package index is up to date. This ensures you get the latest available versions of every package you install. Enter your user password when prompted.",
    code: "sudo apt update && sudo apt upgrade -y",
    label: "Update and upgrade packages",
    tip: "Run this periodically to keep your system secure and up to date.",
  },
  {
    number: 3,
    title: "Install Node.js using NodeSource",
    description:
      "OpenClaw requires Node.js 20 or later. The default version in Ubuntu's apt repositories is often outdated, so we'll add the NodeSource repository to get a current release.",
    code: "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\nsudo apt install -y nodejs",
    label: "Install Node.js 22 via NodeSource",
  },
  {
    number: 4,
    title: "Verify your Node.js and npm installation",
    description:
      "Confirm that both Node.js and npm installed correctly. You should see version numbers for each — Node v22.x.x or higher, and npm 10.x.x or higher.",
    code: "node --version\nnpm --version",
    label: "Check installed versions",
    output: "v22.14.0\n10.9.2",
    tip: "If you see a version older than 20, remove the system Node (sudo apt remove nodejs) and re-run the NodeSource setup above.",
  },
  {
    number: 5,
    title: "Install build tools and system dependencies",
    description:
      "OpenClaw's installer needs curl, git, and build-essential to compile native Node.js modules. Most Ubuntu systems already have these, but this command ensures nothing is missing.",
    code: "sudo apt install -y curl git build-essential",
    label: "Install system dependencies",
  },
  {
    number: 6,
    title: "Create an Anthropic account for Claude",
    description:
      "OpenClaw needs an LLM provider to power its AI agents. We recommend Anthropic's Claude, but you can also use OpenAI or other providers. Start by creating an account (or logging in) at Claude.com.",
    link: "https://claude.com",
    linkLabel: "Go to Claude.com",
  },
  {
    number: 7,
    title: "Generate your Claude API key",
    description:
      "Navigate to the API keys page in the Anthropic console. Create a new key and copy it — you'll paste it during the OpenClaw setup wizard. The key looks like this:",
    link: "https://console.anthropic.com/settings/keys",
    linkLabel: "Claude API keys page",
    code: "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx",
    label: "API key format",
    tip: "Keep this key secret. Never commit it to git or share it publicly.",
  },
  {
    number: 8,
    title: "Install OpenClaw with the official script",
    description:
      "Run the official installer to install OpenClaw on your Linux system. It downloads the OpenClaw binary, places it in your PATH, and creates the default configuration directory at ~/.openclaw.",
    code: "curl -fsSL https://openclaw.ai/install.sh | bash",
    label: "Install OpenClaw",
    output: "Downloading OpenClaw v0.9.4...\nInstalled to /usr/local/bin/openclaw\nSetup complete.",
  },
  {
    number: 9,
    title: "Run the setup wizard",
    description:
      "The onboard command walks you through initial configuration. It will ask for your API key, set up your first agent profile, and install a systemd service that keeps your agents running in the background.",
    code: "openclaw onboard --install-daemon",
    label: "Run the setup wizard",
    tip: "On headless servers, add --no-browser to skip the dashboard auto-open at the end.",
  },
  {
    number: 10,
    title: "Start the gateway",
    description:
      "The gateway is the local server that routes traffic between your agents and external services. Start it and confirm it's listening on the default port.",
    code: "openclaw gateway",
    label: "Start the gateway",
    output: "Gateway started\nListening on port 18789",
  },
  {
    number: 11,
    title: "Open the dashboard",
    description:
      "Point your browser to the gateway URL. You'll see the OpenClaw dashboard where you can create agents, inspect logs, and tune your configuration.",
    link: "http://127.0.0.1:18789",
    linkLabel: "Open OpenClaw dashboard",
    tip: "If you're on a remote server, use SSH port forwarding: ssh -L 18789:localhost:18789 yourserver",
  },
];

const troubleshooting = [
  {
    problem: "\"command not found: openclaw\" after install",
    solution:
      "source ~/.bashrc\n# Or, if you use zsh:\nsource ~/.zshrc",
  },
  {
    problem: "Port 18789 is already in use",
    solution: "openclaw doctor --fix",
  },
  {
    problem: "Permission denied during install",
    solution:
      "curl -fsSL https://openclaw.ai/install.sh | sudo bash",
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
          From a fresh Ubuntu or Debian install to a running OpenClaw gateway
          with your first AI agent, step by step.
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
