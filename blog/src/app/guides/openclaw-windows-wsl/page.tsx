import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Install OpenClaw on Windows with WSL — The Agent Post",
  description:
    "Learn how to install OpenClaw on Windows using WSL. This step-by-step guide covers Ubuntu setup, Node.js, and launching your first AI agent in 15 minutes.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Install WSL on Windows",
    description:
      "Open PowerShell as Administrator (right-click the Start button and choose \"Terminal (Admin)\" or \"PowerShell (Admin)\"). Run the following command to install WSL 2 with Ubuntu as the default Linux distribution. Your machine will likely need to restart after this step.",
    code: "wsl --install",
    label: "Enable WSL and install Ubuntu",
    output: "Installing: Ubuntu\nThe requested operation is successful.\nChanges will not be effective until the system is rebooted.",
    tip: "If WSL is already installed, this command will just print help text. You can skip to the next step.",
  },
  {
    number: 2,
    title: "Launch Ubuntu in WSL and create a user account",
    description:
      "After rebooting, open the Start menu and launch \"Ubuntu\". The first time it runs, WSL will finish setting up and ask you to create a UNIX username and password. Pick something simple — you'll need this password for installing software.",
    code: "Enter new UNIX username: yourname\nNew password: ********",
    label: "First-run setup prompt",
  },
  {
    number: 3,
    title: "Update Ubuntu packages in WSL",
    description:
      "Before installing anything else, make sure your Ubuntu packages inside WSL are up to date. This ensures you have the latest security patches and dependencies.",
    code: "sudo apt update && sudo apt upgrade -y",
    label: "Update and upgrade packages",
    tip: "Run this periodically to keep your WSL environment current.",
  },
  {
    number: 4,
    title: "Install Node.js via NodeSource on Ubuntu",
    description:
      "OpenClaw requires Node.js 20 or higher. The easiest way to install Node.js on Ubuntu WSL is through the NodeSource repository. These commands add the repository and install Node.js along with npm.",
    code: "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\nsudo apt install -y nodejs",
    label: "Install Node.js 22 via NodeSource",
  },
  {
    number: 5,
    title: "Verify your Node.js and npm versions",
    description:
      "Confirm that Node.js and npm are installed and on a supported version. You should see v22.x.x or higher for Node and 10.x.x or higher for npm.",
    code: "node --version && npm --version",
    label: "Check versions",
    output: "v22.14.0\n10.9.2",
  },
  {
    number: 6,
    title: "Get an Anthropic API key for OpenClaw",
    description:
      "OpenClaw needs an LLM provider to power its agents. We recommend Anthropic's Claude, but OpenAI and other providers work too. Head to the Anthropic console, create a new API key, and copy it. The key starts with \"sk-ant-\" — keep it secret.",
    link: "https://console.anthropic.com/settings/keys",
    linkLabel: "Anthropic API keys page",
    code: "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx",
    label: "API key format",
    tip: "Never commit API keys to git. You'll paste this key into the setup wizard in a later step.",
  },
  {
    number: 7,
    title: "Install OpenClaw in your WSL environment",
    description:
      "Back in your WSL Ubuntu terminal, run the OpenClaw installer. It downloads the latest release and adds the openclaw command to your PATH.",
    code: "curl -fsSL https://openclaw.ai/install.sh | bash",
    label: "Install OpenClaw",
    output: "Downloading OpenClaw v0.9.3...\nInstalling to /home/yourname/.openclaw/bin/openclaw\nInstallation complete. Run 'openclaw onboard' to get started.",
  },
  {
    number: 8,
    title: "Reload your Bash shell configuration",
    description:
      "The installer adds OpenClaw to your PATH, but your current shell session doesn't know about it yet. Source your profile to pick up the change, or simply close and reopen your Ubuntu terminal.",
    code: "source ~/.bashrc",
    label: "Reload shell config",
  },
  {
    number: 9,
    title: "Run the setup wizard",
    description:
      "The onboard command walks you through initial configuration. It will ask for your API key, let you pick a default model, and install the background daemon that keeps agents running between sessions.",
    code: "openclaw onboard --install-daemon",
    label: "Run the setup wizard",
    tip: "You can re-run this command later to change your API key or model preferences.",
  },
  {
    number: 10,
    title: "Start the gateway",
    description:
      "The gateway is the local server that connects your agents to external services. Start it up and confirm it's listening on the default port.",
    code: "openclaw gateway",
    label: "Start the gateway",
    output: "Gateway started\nListening on port 18789",
  },
  {
    number: 11,
    title: "Open the dashboard from Windows",
    description:
      "Here's the nice part about WSL — the gateway is accessible from your Windows browser. Open any browser on Windows and navigate to the dashboard URL. You'll see the OpenClaw control panel where you can create agents, view logs, and manage configurations.",
    link: "http://127.0.0.1:18789",
    linkLabel: "Open OpenClaw dashboard",
    tip: "WSL 2 shares the network with Windows by default, so localhost just works.",
  },
];

const troubleshooting = [
  {
    problem: "\"wsl --install\" says virtualization is disabled",
    solution:
      "Enable Intel VT-x or AMD-V in your BIOS/UEFI settings, then reboot and try again.",
  },
  {
    problem: "\"command not found: openclaw\" after install",
    solution: "source ~/.bashrc\n# or close and reopen your Ubuntu terminal",
  },
  {
    problem: "Cannot reach localhost:18789 from the Windows browser",
    solution: "openclaw doctor --fix\n# Also verify WSL 2 is running: wsl -l -v",
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
          Setting Up OpenClaw on Windows&nbsp;with&nbsp;WSL
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Everything you need to go from a stock Windows machine to a running
          OpenClaw installation using the Windows Subsystem for Linux.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: Windows 10
          (version 2004+) or Windows 11 with admin access
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
