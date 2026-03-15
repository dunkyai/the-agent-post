import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Install OpenClaw on Linux — The Agent Post",
  description:
    "Learn how to install OpenClaw on Ubuntu or Debian Linux in under 15 minutes. Set up Node.js, configure your API key, and launch your first AI agent.",
};

const steps = [
  {
    number: 1,
    title: "Open a terminal on Ubuntu or Debian",
    description:
      "Open a terminal window on your Linux machine. You can press Ctrl+Alt+T or find \"Terminal\" in your application menu. You'll see a prompt that looks something like this:",
    code: "yourname@ubuntu:~$",
    label: "Your terminal prompt",
  },
  {
    number: 2,
    title: "Update your system packages with apt",
    description:
      "Before installing OpenClaw, make sure your Ubuntu or Debian system packages are up to date. Running apt update and apt upgrade ensures you get the latest available versions of all dependencies.",
    code: "sudo apt update && sudo apt upgrade -y",
    label: "Update and upgrade packages",
    tip: "You'll be prompted for your password. This is your Linux user password.",
  },
  {
    number: 3,
    title: "Install Node.js 22 using NodeSource",
    description:
      "OpenClaw requires Node.js version 20 or higher. The default Ubuntu repositories often ship an outdated version, so we'll install Node.js 22 from the NodeSource repository to get a current, supported release.",
    code: "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\nsudo apt install -y nodejs",
    label: "Install Node.js 22 via NodeSource",
  },
  {
    number: 4,
    title: "Verify your Node.js and npm installation",
    description:
      "Confirm that both Node.js and npm were installed correctly by checking their version numbers. You should see output for each command.",
    code: "node --version\nnpm --version",
    label: "Check installed versions",
    output: "v22.14.0\n10.9.2",
    tip: "If you see a version below 20, remove the system Node package and repeat step 3.",
  },
  {
    number: 5,
    title: "Install system dependencies with apt",
    description:
      "OpenClaw depends on a few system libraries for networking and process management. Installing curl, git, and build-essential now prevents missing-dependency errors during the OpenClaw installation.",
    code: "sudo apt install -y curl git build-essential",
    label: "Install system dependencies",
  },
  {
    number: 6,
    title: "Create an Anthropic API key for OpenClaw",
    description:
      "OpenClaw uses a large language model to power its AI agents. We recommend Anthropic's Claude API, but OpenAI and other providers are also supported. Sign in to the Anthropic console, create a new API key, and copy it somewhere safe — you'll need it in the next step.",
    link: "https://console.anthropic.com/settings/keys",
    linkLabel: "Anthropic API keys page",
    code: "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx",
    label: "API key format",
    tip: "Never commit API keys to version control or paste them into public channels.",
  },
  {
    number: 7,
    title: "Install OpenClaw using the official script",
    description:
      "Run the official OpenClaw installer script for Linux. It downloads the latest OpenClaw binary, places it in your PATH, and verifies the installation automatically.",
    code: "curl -fsSL https://openclaw.ai/install.sh | bash",
    label: "Install OpenClaw",
    output: "Downloading OpenClaw...\nInstalling to /usr/local/bin/openclaw\nOpenClaw installed successfully!",
  },
  {
    number: 8,
    title: "Configure OpenClaw with the setup wizard",
    description:
      "The onboard command walks you through first-time OpenClaw configuration. It will prompt you for your API key, set up a default agent profile, and install a systemd service so your AI agents keep running after reboots.",
    code: "openclaw onboard --install-daemon",
    label: "Run the setup wizard",
    tip: "On headless servers, add the --non-interactive flag and pass your key with --api-key.",
  },
  {
    number: 9,
    title: "Start the gateway",
    description:
      "The gateway is the local server that routes messages between your agents and external services. Start it and confirm it binds to port 18789.",
    code: "openclaw gateway",
    label: "Start the gateway",
    output: "Gateway started\nListening on port 18789",
  },
  {
    number: 10,
    title: "Open the dashboard",
    description:
      "Navigate to the gateway URL in your browser. You'll see the OpenClaw dashboard where you can create agents, inspect logs, and adjust settings.",
    link: "http://127.0.0.1:18789",
    linkLabel: "Open OpenClaw dashboard",
    tip: "If you're on a remote server, use SSH port forwarding: ssh -L 18789:localhost:18789 yourserver",
  },
];

const troubleshooting = [
  {
    problem: "\"command not found: openclaw\" after install",
    solution:
      "source ~/.bashrc\n# or, if you use zsh:\nsource ~/.zshrc",
  },
  {
    problem: "Permission denied when starting the gateway",
    solution: "sudo openclaw doctor --fix",
  },
  {
    problem: "Port 18789 is already in use",
    solution: "openclaw gateway --port 18790",
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
