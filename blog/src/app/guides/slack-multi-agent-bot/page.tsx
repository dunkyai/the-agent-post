import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Build a Multi-Agent Slack Bot — The Agent Post",
  description:
    "Learn how to build a multi-agent Slack bot with OpenClaw. Create a router that dispatches messages to specialized AI agents for code review and docs search.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Verify your OpenClaw installation",
    description:
      "Make sure OpenClaw is installed and running on your machine. You'll also need a Slack workspace where you have permission to create apps. Run the CLI commands below to verify your setup.",
    code: "openclaw --version\nopenclaw status",
    label: "Verify OpenClaw is ready",
    output:
      "openclaw v0.14.2\nGateway: running on port 18789\nAgents: 0 active",
    tip: "If OpenClaw isn't installed yet, follow our OpenClaw Setup Guide first.",
  },
  {
    number: 2,
    title: "Create a Slack app and generate API tokens",
    description:
      'Go to the Slack API dashboard and create a new app from scratch. Add the bot token scopes listed below, enable Socket Mode, and subscribe to the app_mention and message.im events. Then install the app to your workspace. You\'ll need both the Bot User OAuth Token (starts with xoxb-) and the App-Level Token (starts with xapp-).',
    link: "https://api.slack.com/apps",
    linkLabel: "Slack API dashboard",
    code: "# Required bot token scopes\napp_mentions:read\nchat:write\nchannels:history\nim:history\nim:write",
    label: "Bot token scopes to add",
  },
  {
    number: 3,
    title: "Store Slack API tokens with OpenClaw secrets",
    description:
      "Use the OpenClaw secrets manager to securely store both Slack tokens. These are injected into your agents at runtime so you never have to hard-code credentials.",
    code: "openclaw secrets set SLACK_BOT_TOKEN xoxb-your-bot-token\nopenclaw secrets set SLACK_APP_TOKEN xapp-your-app-token",
    label: "Store tokens securely",
    tip: "Run openclaw secrets list to confirm both tokens are saved.",
  },
  {
    number: 4,
    title: "Scaffold a multi-agent workspace with the OpenClaw CLI",
    description:
      "Use the OpenClaw CLI to generate a new multi-agent workspace. The --multi flag scaffolds a project with a router agent and room for specialist agents that handle different types of requests.",
    code: "openclaw create workspace slack-team --template slack --multi\ncd slack-team",
    label: "Create a multi-agent workspace",
    output:
      'Created workspace "slack-team"\n  \u2192 workspace.yaml\n  \u2192 agents/router/agent.yaml\n  \u2192 agents/router/system-prompt.md\n  \u2192 connectors/slack.yaml',
  },
  {
    number: 5,
    title: "Create a code-review specialist agent",
    description:
      "Add your first specialist agent. This one handles code-related questions \u2014 reviewing snippets, explaining errors, and suggesting fixes. The --role flag tells the router what kinds of messages to send its way.",
    code: 'openclaw create agent code-reviewer \\\n  --workspace slack-team \\\n  --role "code review, debugging, programming questions"',
    label: "Add a code-review agent",
    output:
      'Created agent "code-reviewer" in workspace slack-team\n  \u2192 agents/code-reviewer/agent.yaml\n  \u2192 agents/code-reviewer/system-prompt.md',
  },
  {
    number: 6,
    title: "Create a docs-search specialist agent",
    description:
      "Add a second specialist that handles documentation and knowledge-base queries. This agent can search your docs folder and return relevant answers with source links.",
    code: 'openclaw create agent docs-searcher \\\n  --workspace slack-team \\\n  --role "documentation lookup, how-to questions, wiki search"',
    label: "Add a docs-search agent",
    output:
      'Created agent "docs-searcher" in workspace slack-team\n  \u2192 agents/docs-searcher/agent.yaml\n  \u2192 agents/docs-searcher/system-prompt.md',
  },
  {
    number: 7,
    title: "Configure the router agent for intent classification",
    description:
      "Open the router agent's config file. The router uses intent classification to inspect each incoming Slack message and decide which specialist should handle it. If no specialist matches, the router answers directly as a general-purpose assistant.",
    code: "# agents/router/agent.yaml\nname: router\nmodel: claude-haiku-4-5\ntemperature: 0.1\nsystem_prompt: ./system-prompt.md\nrouting:\n  strategy: intent-classification\n  fallback: self\n  agents:\n    - code-reviewer\n    - docs-searcher",
    label: "agents/router/agent.yaml",
    tip: "Use a fast, cheap model like claude-haiku-4-5 for the router \u2014 it only needs to classify intent, not generate long answers.",
  },
  {
    number: 8,
    title: "Set up specialist agent models and tools",
    description:
      "Each specialist gets its own model and tools. The code reviewer uses a capable model with a code execution tool. The docs searcher gets the file-search tool pointed at your documentation directory.",
    code: "# agents/code-reviewer/agent.yaml\nname: code-reviewer\nmodel: claude-sonnet-4-6\ntemperature: 0.2\nsystem_prompt: ./system-prompt.md\ntools:\n  - code_execution\n  - web_search\n\n# agents/docs-searcher/agent.yaml\nname: docs-searcher\nmodel: claude-sonnet-4-6\ntemperature: 0.1\nsystem_prompt: ./system-prompt.md\ntools:\n  - file_search:\n      path: ./knowledge-base",
    label: "Specialist agent configs",
  },
  {
    number: 9,
    title: "Add your knowledge base",
    description:
      "Create a knowledge-base directory and drop in your team's documentation \u2014 markdown files, FAQs, runbooks, whatever your docs searcher should know about. OpenClaw indexes these files automatically when the agent starts.",
    code: "mkdir -p knowledge-base\ncp ~/docs/runbooks/*.md knowledge-base/\ncp ~/docs/faq.md knowledge-base/",
    label: "Populate the knowledge base",
    tip: "Organize files by topic for better search results. The agent performs best with focused, well-structured markdown files.",
  },
  {
    number: 10,
    title: "Test the multi-agent Slack bot locally",
    description:
      "Start the entire workspace in dev mode. OpenClaw launches the router and all specialist agents, connects to Slack via Socket Mode, and begins listening for mentions. Try different types of questions to verify that routing works correctly.",
    code: "openclaw dev --workspace slack-team",
    label: "Start all agents in dev mode",
    output:
      'Loading workspace "slack-team" (3 agents)...\n  \u2713 router (claude-haiku-4-5)\n  \u2713 code-reviewer (claude-sonnet-4-6)\n  \u2713 docs-searcher (claude-sonnet-4-6)\nConnecting to Slack (socket mode)...\nConnected as @SlackTeam Bot\nListening for events \u2014 press Ctrl+C to stop',
  },
  {
    number: 11,
    title: "Deploy your multi-agent Slack bot",
    description:
      "Deploy the entire workspace to production as a persistent service. OpenClaw registers all three agents as daemons that auto-restart on failure and reconnect to Slack if the connection drops.",
    code: "openclaw deploy --workspace slack-team\nopenclaw status",
    label: "Deploy and verify",
    output:
      'Deploying workspace "slack-team"...\nAll 3 agents deployed\n\nAgent           Status    Model              Uptime\nrouter          running   claude-haiku-4-5   just now\ncode-reviewer   running   claude-sonnet-4-6  just now\ndocs-searcher   running   claude-sonnet-4-6  just now',
  },
];

const troubleshooting = [
  {
    problem: "Router sends every message to the same agent",
    solution:
      "Check that each specialist has a distinct --role description in its config.\nRun: openclaw logs router --tail 20\nLook for classification scores to debug routing decisions.",
  },
  {
    problem: '"agent not found" error when starting the workspace',
    solution:
      "Make sure each agent listed in the router's routing.agents array\nhas a matching directory under agents/.\nRun: openclaw workspace validate",
  },
  {
    problem: "Docs searcher returns empty results",
    solution:
      "Verify your knowledge-base directory contains files:\nls knowledge-base/\nThen rebuild the index: openclaw tools reindex --agent docs-searcher",
  },
];

export default function SlackMultiAgentBotGuide() {
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
          How to Build a Multi-Agent Slack Bot with OpenClaw
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Create an AI-powered Slack bot that uses multiple OpenClaw agents
          working as a team. A router agent classifies each incoming message by
          intent and dispatches it to the right specialist &mdash; a code
          reviewer, a docs searcher, or any custom agent you add.
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
