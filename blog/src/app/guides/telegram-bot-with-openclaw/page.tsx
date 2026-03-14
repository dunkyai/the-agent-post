import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Build an AI Telegram Bot with OpenClaw — The Agent Post",
  description:
    "Learn how to build an AI-powered Telegram bot with OpenClaw. This guide covers BotFather setup, agent configuration, and deployment in under 15 minutes.",
};

const steps = [
  {
    number: 1,
    title: "Find @BotFather on Telegram",
    description:
      "Every Telegram bot starts with @BotFather, Telegram's official bot-creation tool. Open the Telegram app on your phone or desktop, search for \"@BotFather\", and start a chat to begin setting up your AI bot.",
    link: "https://t.me/BotFather",
    linkLabel: "Open BotFather in Telegram",
  },
  {
    number: 2,
    title: "Create a new Telegram bot with BotFather",
    description:
      "Send the /newbot command to BotFather. It will ask you for a display name (e.g. \"My OpenClaw Bot\") and a unique username ending in \"bot\" (e.g. \"my_openclaw_bot\"). Once finished, BotFather provides your bot API token.",
    code: "/newbot",
    label: "Send this message to BotFather",
    output:
      'Done! Congratulations on your new bot.\nUse this token to access the HTTP API:\n7123456789:AAF1x..._example_token\nKeep your token secure and store it safely.',
    tip: "Copy the token immediately. You'll need it in a later step.",
  },
  {
    number: 3,
    title: "Initialize a new OpenClaw project",
    description:
      "Back in your terminal, scaffold a new OpenClaw project for your Telegram bot. This creates a project folder with the recommended directory structure, a default AI agent definition, and a package.json ready to go.",
    code: "openclaw init telegram-bot",
    label: "Scaffold a new project",
    output:
      "Created project: telegram-bot/\n  agents/\n  adapters/\n  openclaw.config.yaml\n  package.json",
  },
  {
    number: 4,
    title: "Navigate to the project directory",
    description:
      "Change into the newly created project folder. All remaining commands should be run from inside this directory.",
    code: "cd telegram-bot",
    label: "Enter the project directory",
  },
  {
    number: 5,
    title: "Install the OpenClaw Telegram adapter",
    description:
      "OpenClaw uses adapters to connect AI agents to messaging platforms like Telegram. Install the official Telegram adapter package, which handles polling for messages, formatting replies, and managing bot sessions.",
    code: "openclaw adapter add telegram",
    label: "Add the Telegram adapter",
    output: "Installed adapter: @openclaw/adapter-telegram (v1.4.0)",
  },
  {
    number: 6,
    title: "Store your Telegram bot API token",
    description:
      "Save your Telegram bot API token as an OpenClaw project secret. This keeps it out of your source code and config files. Paste the token you copied from BotFather when prompted.",
    code: "openclaw secret set TELEGRAM_BOT_TOKEN",
    label: "Store the bot token as a secret",
    tip: "Never commit bot tokens to version control. OpenClaw secrets are stored in an encrypted local vault.",
  },
  {
    number: 7,
    title: "Configure the AI agent and Telegram adapter",
    description:
      "Open openclaw.config.yaml and add the Telegram adapter block. This tells OpenClaw which adapter to load and which AI agent should handle incoming Telegram messages. Create or edit the config file with the following content:",
    code: `# openclaw.config.yaml

agent:
  name: telegram-assistant
  model: claude-sonnet-4-6
  system_prompt: |
    You are a helpful Telegram bot. Keep replies concise
    and conversational. Use markdown formatting sparingly.

adapters:
  telegram:
    token_secret: TELEGRAM_BOT_TOKEN
    parse_mode: Markdown`,
    label: "openclaw.config.yaml",
    tip: "You can swap the model for any supported LLM. Run \"openclaw models\" to see the full list.",
  },
  {
    number: 8,
    title: "Test your Telegram bot locally",
    description:
      "Start the bot in development mode. OpenClaw connects to Telegram using long polling, so you can test without setting up webhooks. Open Telegram and send a message to your bot — you should get an AI-powered reply within a few seconds.",
    code: "openclaw dev",
    label: "Start the bot in dev mode",
    output:
      "Agent loaded: telegram-assistant\nTelegram adapter connected (polling)\nReady — send a message to @my_openclaw_bot",
  },
  {
    number: 9,
    title: "Deploy your Telegram bot as a daemon",
    description:
      "Once you're happy with how the bot responds, deploy it as a persistent background daemon so it keeps running after you close the terminal. The daemon auto-restarts on crashes and survives server reboots.",
    code: "openclaw deploy --daemon",
    label: "Deploy the bot",
    output:
      "Deployed: telegram-assistant\nStatus: running (pid 48201)\nLogs:   openclaw logs -f",
  },
  {
    number: 10,
    title: "Verify your Telegram bot is live",
    description:
      "Check that your bot daemon is running and the Telegram connection is healthy. The status command shows uptime, message count, and any recent errors.",
    code: "openclaw status",
    label: "Check daemon status",
    output:
      "telegram-assistant\n  Status:   running\n  Uptime:   2m 14s\n  Messages: 3 received, 3 sent\n  Adapter:  telegram (polling)\n  Errors:   0",
  },
];

const troubleshooting = [
  {
    problem: "Bot replies in Telegram are slow or delayed",
    solution:
      "openclaw config set adapters.telegram.timeout 30\nopenclaw restart",
  },
  {
    problem: "\"Unauthorized\" error when starting your Telegram bot",
    solution:
      "openclaw secret set TELEGRAM_BOT_TOKEN\n# Re-enter your token — it may have been revoked or mistyped",
  },
  {
    problem: "\"adapter not found: telegram\" after install",
    solution: "openclaw adapter list\nopenclaw adapter add telegram --force",
  },
];

export default function TelegramBotGuidePage() {
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
          How to Build an AI Telegram Bot with OpenClaw
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Use BotFather to register your bot, connect it to an OpenClaw AI
          agent, and deploy it as a persistent daemon &mdash; all from your
          terminal.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: OpenClaw
          installed, Telegram account
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
