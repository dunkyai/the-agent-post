import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title:
    "How to Build an AI Slack Bot with OpenClaw — The Agent Post",
  description:
    "Learn how to build an AI-powered Slack bot with OpenClaw agents. This step-by-step guide covers setup, configuration, and deployment in under 15 minutes.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Create a new Slack app",
    description:
      "Head to the Slack API dashboard and click \"Create New App.\" Choose \"From scratch,\" give your bot a name like \"OpenClaw Bot,\" and select the workspace you want to install it in. This creates the container that holds your bot's permissions and event subscriptions.",
    link: "https://api.slack.com/apps",
    linkLabel: "Slack API dashboard",
  },
  {
    number: 2,
    title: "Add Slack bot token scopes",
    description:
      "In your app settings, navigate to \"OAuth & Permissions\" and scroll to \"Bot Token Scopes.\" Add the scopes listed below. These give your bot permission to read messages in channels it's invited to and post replies.",
    code: "app_mentions:read\nchat:write\nchannels:history\ngroups:history\nim:history\nim:write",
    label: "Required bot token scopes",
    tip: "Start with the minimum scopes. You can add more later if your agent needs to upload files, manage channels, or add reactions.",
  },
  {
    number: 3,
    title: "Enable Slack Socket Mode",
    description:
      "Go to \"Socket Mode\" in the left sidebar and toggle it on. Socket Mode lets your bot receive events over a WebSocket connection instead of requiring a public URL — perfect for local development. Slack will prompt you to generate an app-level token. Name it something like \"openclaw-socket\" and copy the token.",
    code: "xapp-x-xxxxxxxxxxxx-xxxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx",
    label: "App-level token format",
    tip: "Socket Mode is ideal for development and small teams. For high-traffic production bots, you can switch to the HTTP Events API later.",
  },
  {
    number: 4,
    title: "Subscribe to Slack bot events",
    description:
      "Go to \"Event Subscriptions\" in the sidebar and toggle it on. Under \"Subscribe to bot events,\" add the two events below. These tell Slack to notify your bot whenever someone @mentions it or sends it a direct message.",
    code: "app_mention\nmessage.im",
    label: "Bot events to subscribe to",
  },
  {
    number: 5,
    title: "Install the Slack app to your workspace",
    description:
      "Click \"Install App\" in the sidebar, then \"Install to Workspace.\" Slack will ask you to authorize the permissions you configured. After approving, you'll see a Bot User OAuth Token — copy it and keep it safe.",
    code: "xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx",
    label: "Bot token format",
  },
  {
    number: 6,
    title: "Store your Slack tokens in OpenClaw",
    description:
      "Back in your terminal, use the OpenClaw secrets manager to store both tokens. This keeps them encrypted and out of your source code. OpenClaw injects them into your agent's environment at runtime.",
    code: "openclaw secrets set SLACK_BOT_TOKEN xoxb-your-bot-token-here\nopenclaw secrets set SLACK_APP_TOKEN xapp-your-app-token-here",
    label: "Store Slack credentials securely",
    tip: "Never paste tokens directly into config files or commit them to git. Always use openclaw secrets for credentials.",
  },
  {
    number: 7,
    title: "Scaffold a Slack bot agent with the OpenClaw CLI",
    description:
      "Use the OpenClaw CLI to generate a new AI agent project with the built-in Slack bot template. This creates a directory with the agent definition, a system prompt, and the Slack connector already wired up.",
    code: "openclaw create agent slack-bot --template slack\ncd slack-bot",
    label: "Create agent from Slack template",
    output:
      "Created agent \"slack-bot\" from template slack\n  → agent.yaml\n  → system-prompt.md\n  → connectors/slack.yaml\n  → README.md",
  },
  {
    number: 8,
    title: "Configure the OpenClaw agent",
    description:
      "Open agent.yaml in your editor. This is where you configure your AI agent's model, temperature, and available tools. The Slack bot template comes with sensible defaults, but you should customize the name and description for your use case.",
    code: "# agent.yaml\nname: slack-bot\nmodel: claude-sonnet-4-6\ntemperature: 0.3\nsystem_prompt: ./system-prompt.md\nconnectors:\n  - ./connectors/slack.yaml\ntools:\n  - web_search\n  - calculator",
    label: "agent.yaml",
    tip: "Use a low temperature (0.2–0.4) for factual Q&A bots. Bump it to 0.7+ for creative or conversational bots.",
  },
  {
    number: 9,
    title: "Write the bot's system prompt",
    description:
      "Open system-prompt.md and write the instructions that define how your Slack bot behaves. Be specific about its role, tone, what it should and shouldn't do, and how it should format responses for Slack.",
    code: "You are a helpful assistant in our team's Slack workspace.\n\nRules:\n- Answer questions concisely and accurately.\n- If you don't know something, say so — don't guess.\n- Use thread replies when responding to channel messages.\n- Never share API keys, passwords, or internal credentials.\n- Format code with Slack-compatible markdown.",
    label: "system-prompt.md example",
  },
  {
    number: 10,
    title: "Test your Slack bot locally",
    description:
      "Run the agent in development mode. This starts a local instance that connects to Slack via Socket Mode. Once you see \"Connected,\" go to your Slack workspace and mention your bot in any channel it's been invited to.",
    code: "openclaw dev",
    label: "Start the agent in dev mode",
    output:
      "Loading agent \"slack-bot\"...\nConnecting to Slack (socket mode)...\nConnected as @OpenClaw Bot\nListening for events — press Ctrl+C to stop",
  },
  {
    number: 11,
    title: "Send a test message in Slack",
    description:
      "In Slack, invite your bot to a channel by typing /invite @OpenClaw Bot. Then @mention it with a question. You should see the agent process the message in your terminal and reply in a thread within a few seconds.",
    code: "@OpenClaw Bot summarize our Q1 roadmap",
    label: "Example mention in Slack",
    output:
      "Event received: app_mention in #general\nAgent processing... (1.4s)\nReply sent to thread",
  },
  {
    number: 12,
    title: "Deploy your Slack bot to production",
    description:
      "When you're ready for production, deploy your Slack bot as a persistent daemon. The daemon auto-restarts on crashes and reconnects if the WebSocket drops. Check on it anytime with the status command.",
    code: "openclaw deploy slack-bot\nopenclaw status",
    label: "Deploy and check status",
    output:
      "Deploying agent \"slack-bot\"...\nDaemon registered and started\n\nAgent        Status    Uptime     Last Event\nslack-bot    running   just now   —",
  },
];

const troubleshooting = [
  {
    problem: "Slack bot connects but doesn't respond to @mentions",
    solution:
      "Verify that app_mention is listed under Event Subscriptions in your Slack app settings.\nThen reinstall the app: OAuth & Permissions → Reinstall to Workspace.",
  },
  {
    problem: "\"token_revoked\" or \"invalid_auth\" errors in the terminal",
    solution:
      "Your bot token may have been rotated. Re-copy it from Slack and update:\nopenclaw secrets set SLACK_BOT_TOKEN xoxb-your-new-token\nopenclaw restart slack-bot",
  },
  {
    problem: "Slack bot replies are slow or timing out",
    solution:
      "openclaw logs slack-bot --tail 50\n# Look for retry loops or rate-limit warnings.\n# For faster responses, switch to a smaller model in agent.yaml:\n# model: claude-haiku-4-5",
  },
];

export default function SlackBotGuide() {
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
          How to Build an AI Slack Bot with OpenClaw Agents
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Build and deploy an AI-powered Slack bot using OpenClaw agents. Your
          bot will answer questions, run tools, and respond to mentions —
          configured with a single YAML file and ready in minutes.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: OpenClaw
          installed, a Slack workspace where you can create apps
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
