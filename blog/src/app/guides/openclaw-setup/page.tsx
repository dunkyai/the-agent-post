import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "OpenClaw Setup Guide — The Agent Post",
  description:
    "Step-by-step guide to setting up OpenClaw on your Mac. Install Homebrew, Node.js, and OpenClaw, then launch your first AI agent in minutes.",
};

const steps = [
  {
    number: 1,
    title: "Open your terminal",
    description:
      "On a Mac, open the Terminal app. You can find it in Applications > Utilities, or press Cmd+Space and type \"Terminal\". You'll see a command line prompt that looks something like this:",
    code: "yourname@Mac-mini ~ %",
    label: "Your terminal prompt",
  },
  {
    number: 2,
    title: "Install Homebrew",
    description:
      "Homebrew is the package manager for macOS. If you don't already have it, paste this command into your terminal and press Enter. It will ask for your password — that's your Mac login password.",
    code: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    label: "Install Homebrew",
  },
  {
    number: 3,
    title: "Confirm Homebrew works",
    description:
      "Once the installation finishes, verify that Homebrew is working by checking its version. You should see a version number like \"Homebrew 4.x.x\".",
    code: "brew --version",
    label: "Check Homebrew version",
  },
  {
    number: 4,
    title: "Install Node.js",
    description:
      "OpenClaw runs on Node.js. Install it with Homebrew. This will also install npm, the Node package manager.",
    code: "brew install node",
    label: "Install Node.js via Homebrew",
  },
  {
    number: 5,
    title: "Verify Node installation",
    description:
      "Make sure Node.js installed correctly. You should see a version number like \"v22.x.x\" or higher.",
    code: "node --version",
    label: "Check Node.js version",
    tip: "If Node is already installed but outdated, run: brew upgrade node",
  },
  {
    number: 6,
    title: "Create a Claude account",
    description:
      "OpenClaw needs an LLM as a brain. We suggest using Anthropic but you can pick OpenAI or other LLMs. To use Anthropic, you'll need an API key. First, create an account (or log in) at Claude.com.",
    link: "https://claude.com",
    linkLabel: "Go to Claude.com",
  },
  {
    number: 7,
    title: "Get your API key",
    description:
      "Head to the API keys page in your Claude console. Create a new key and copy it somewhere safe. You'll need it during the OpenClaw setup. The key looks like this:",
    link: "https://console.anthropic.com/settings/keys",
    linkLabel: "Claude API keys page",
    code: "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx",
    label: "API key format",
    tip: "Keep this key secret. Don't commit it to git or share it publicly.",
  },
  {
    number: 8,
    title: "Install OpenClaw",
    description:
      "Now for the main event. Run the OpenClaw installer. This will download and set up everything you need.",
    code: "curl -fsSL https://openclaw.ai/install.sh | bash",
    label: "Install OpenClaw",
  },
  {
    number: 9,
    title: "Run the setup wizard",
    description:
      "The onboard command launches an interactive setup wizard. It will ask for your Claude API key, configure your first agent, and install the background daemon that keeps your agents running.",
    code: "openclaw onboard --install-daemon",
    label: "Run the setup wizard",
  },
  {
    number: 10,
    title: "Start the gateway",
    description:
      "The gateway is the local server that connects your agents to the outside world. Start it up and you should see it listening on port 18789.",
    code: "openclaw gateway",
    label: "Start the gateway",
    output: "Gateway started\nListening on port 18789",
  },
  {
    number: 11,
    title: "Meet OpenClaw in your browser",
    description:
      "Open your browser and navigate to the gateway URL. You'll see the OpenClaw dashboard where you can manage your agents, view logs, and configure your setup.",
    link: "http://127.0.0.1:18789",
    linkLabel: "Open OpenClaw dashboard",
  },
];

const troubleshooting = [
  {
    problem: "Port 18789 is already in use",
    solution: "openclaw doctor --fix",
  },
  {
    problem: "Node.js version is too old",
    solution: "brew upgrade node",
  },
  {
    problem: "\"command not found: openclaw\" after install",
    solution: "Close and reopen your terminal, then try again.",
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
          OpenClaw Setup Guide
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Everything you need to go from zero to a running OpenClaw
          installation, step by step.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: macOS with
          admin access
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
