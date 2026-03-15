import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Build an AI Slack Bot with OpenClaw — The Agent Post",
  description:
    "Learn how to build an AI-powered Slack bot with OpenClaw agents in this step-by-step guide. Set up a Slack app, connect your agent, and deploy to production.",
};

const steps = [
  {
    number: 1,
    title: "Create a new Slack app from scratch",
    description:
      "Head to the Slack API portal and click \"Create New App\". Choose \"From scratch\", name your bot something like \"OpenClaw Bot\", and select the Slack workspace you want to install it to.",
    link: "https://api.slack.com/apps",
    linkLabel: "Slack API portal",
  },
  {
    number: 2,
    title: "Configure Slack bot OAuth scopes",
    description:
      "In your Slack app settings, go to OAuth & Permissions. Under \"Bot Token Scopes\", add the permissions your bot needs. At minimum, add these scopes for reading and sending messages:",
    code: "app_mentions:read\nchat:write\nchannels:history\nim:history\nim:write",
    label: "Required bot token scopes",
    tip: "Only request scopes your bot actually needs. You can always add more later.",
  },
  {
    number: 3,
    title: "Enable Slack Event Subscriptions",
    description:
      "Go to Event Subscriptions in your Slack app settings and toggle it on. Under \"Subscribe to bot events\", add app_mention and message.im. This tells Slack to send your bot a notification whenever someone @mentions it or sends it a direct message. Leave the Request URL blank for now — we'll fill it in after starting the gateway.",
    code: "app_mention\nmessage.im",
    label: "Bot events to subscribe to",
  },
  {
    number: 4,
    title: "Install the Slack app and get your bot token",
    description:
      "Go to \"Install App\" in the sidebar and click \"Install to Workspace\". Slack will ask you to authorize the bot permissions. After installing, you'll see a Bot User OAuth Token that starts with xoxb-. Copy this token — you'll need it in the next step.",
    code: "xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx",
    label: "Bot token format",
    tip: "Keep this token secret. Treat it like a password.",
  },
  {
    number: 5,
    title: "Store your Slack bot token and signing secret",
    description:
      "Back in your terminal, save your Slack bot token and signing secret as OpenClaw secrets. The signing secret is found under \"Basic Information\" in your Slack app settings. OpenClaw encrypts these credentials and makes them available to your agent at runtime.",
    code: "openclaw secrets set SLACK_BOT_TOKEN xoxb-your-token-here\nopenclaw secrets set SLACK_SIGNING_SECRET your-signing-secret",
    label: "Store Slack credentials",
  },
  {
    number: 6,
    title: "Create an OpenClaw agent with the Slack template",
    description:
      "Use the OpenClaw CLI to generate a new AI agent preconfigured for Slack. This creates an agent directory with the Slack integration, a default system prompt, and the event handler wiring already in place.",
    code: "openclaw agent create slack-bot --template slack",
    label: "Scaffold a Slack bot agent",
    output: "Created agent: slack-bot\n  → agents/slack-bot/agent.yaml\n  → agents/slack-bot/prompt.md\n  → agents/slack-bot/hooks/slack_events.js",
  },
  {
    number: 7,
    title: "Customize your AI agent's system prompt",
    description:
      "Open the generated prompt file and tailor it to your bot's personality and purpose. This is the system prompt your agent uses when responding to Slack messages. Be specific about tone, what topics the bot should help with, and any boundaries.",
    code: "open agents/slack-bot/prompt.md",
    label: "Open the prompt file",
    tip: "Keep the prompt concise. A focused 5-10 line prompt usually outperforms a long, overly detailed one.",
  },
  {
    number: 8,
    title: "Start the OpenClaw gateway for Slack",
    description:
      "Launch the OpenClaw gateway with the Slack integration enabled. The gateway handles incoming webhook events from Slack, verifies request signatures, and routes messages to your AI agent.",
    code: "openclaw gateway --integration slack",
    label: "Start the gateway",
    output: "Gateway started\nSlack integration: enabled\nListening on port 18789\nWebhook endpoint: http://127.0.0.1:18789/slack/events",
  },
  {
    number: 9,
    title: "Expose your local server with a public tunnel URL",
    description:
      "Slack needs a public URL to send events to. OpenClaw has a built-in tunnel command that creates a secure public URL pointing to your local gateway. Copy the HTTPS URL it gives you.",
    code: "openclaw tunnel",
    label: "Start the tunnel",
    output: "Tunnel established\nPublic URL: https://abc123.tunnel.openclaw.ai\nForwarding to: http://127.0.0.1:18789",
  },
  {
    number: 10,
    title: "Set the Slack Event Subscriptions Request URL",
    description:
      "Go back to your Slack app's Event Subscriptions page. Paste your tunnel URL with the /slack/events path into the Request URL field. Slack will send a challenge request to verify it — if the gateway is running, it will respond automatically and you'll see a green checkmark.",
    code: "https://abc123.tunnel.openclaw.ai/slack/events",
    label: "Request URL to paste in Slack",
    tip: "If verification fails, make sure both the gateway and tunnel are running. Check the gateway logs for errors.",
  },
  {
    number: 11,
    title: "Test your AI Slack bot in a channel",
    description:
      "Go to any Slack channel where your bot is a member (invite it with /invite @OpenClaw Bot) and mention it. Your AI bot should respond within a few seconds. You can also test it by sending a direct message.",
    code: "@OpenClaw Bot what can you help me with?",
    label: "Example mention in Slack",
  },
  {
    number: 12,
    title: "Deploy your Slack bot to OpenClaw cloud",
    description:
      "When you're ready to go live, deploy your agent to the OpenClaw cloud. This gives you a permanent public URL so you can replace the tunnel. After deploying, update your Slack app's Request URL with the new production endpoint.",
    code: "openclaw deploy slack-bot",
    label: "Deploy to OpenClaw cloud",
    output: "Deploying slack-bot...\nBuild: success\nEndpoint: https://slack-bot.agents.openclaw.ai/slack/events\nStatus: live",
  },
];

const troubleshooting = [
  {
    problem: "Fix \"url_verification_failed\" error when setting the Slack Request URL",
    solution:
      "Make sure the gateway is running (openclaw gateway --integration slack) and the tunnel is active (openclaw tunnel). Both must be up before Slack can verify.",
  },
  {
    problem: "Slack bot not responding to @mentions in a channel",
    solution:
      "Invite the bot to the channel first with: /invite @OpenClaw Bot\nAlso verify app_mention is listed under Event Subscriptions.",
  },
  {
    problem: "Fix \"invalid_signing_secret\" error in OpenClaw gateway logs",
    solution:
      "Re-copy the Signing Secret from Slack > Basic Information and update it:\nopenclaw secrets set SLACK_SIGNING_SECRET your-correct-secret",
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
          Follow this step-by-step tutorial to connect an OpenClaw AI agent to
          Slack and deploy a bot that responds to mentions and direct messages
          in your workspace.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: OpenClaw
          installed, a Slack workspace with admin access
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
