import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Your First OpenClaw Agent — The Agent Post",
  description:
    "Step-by-step guide to creating, configuring, and deploying your first AI agent with OpenClaw. From agent creation to dashboard in 5 minutes.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Make sure OpenClaw is running",
    description:
      "Before creating an agent, confirm that your OpenClaw installation is up and the gateway is active. Run the status command and look for the gateway in the output. You should see it listed as running on port 18789.",
    code: "openclaw status",
    label: "Check OpenClaw status",
    output: "Gateway: running (port 18789)\nDaemon: running (pid 4821)",
  },
  {
    number: 2,
    title: "Create a new agent",
    description:
      "This command creates a new agent with the name \"my-agent\". OpenClaw generates a configuration file for the agent, assigns it a unique ID, and registers it in the local agent registry. The name is how you will refer to this agent in all future commands.",
    code: 'openclaw agent create --name "my-agent"',
    label: "Create your agent",
    output: "Agent created: my-agent (id: a1b2c3d4)",
  },
  {
    number: 3,
    title: "Give it a role",
    description:
      "Every agent needs a system prompt that defines its personality and purpose. The set-role command assigns a system prompt to your agent. This is the instruction the agent receives before every conversation, telling it who it is and how to behave. Think of it as the agent's job description.",
    code: 'openclaw agent set-role my-agent "You are a helpful research assistant"',
    label: "Set the agent's system prompt",
    tip: "You can change the role at any time by running set-role again. Be specific about what the agent should and should not do.",
  },
  {
    number: 4,
    title: "Add a tool",
    description:
      "Tools give your agent capabilities beyond plain conversation. The web-search tool lets your agent search the internet to answer questions with up-to-date information. Without tools, an agent can only respond from its training data. You can add multiple tools to a single agent.",
    code: "openclaw agent add-tool my-agent web-search",
    label: "Add the web-search tool",
    output: "Tool added: web-search -> my-agent",
    tip: "Run \"openclaw tools list\" to see all available tools you can add.",
  },
  {
    number: 5,
    title: "Test the agent",
    description:
      "Now try an interactive test. The chat command sends a message to your agent and prints the response directly in your terminal. This is the quickest way to verify that your agent is working and that its role and tools are configured correctly.",
    code: 'openclaw agent chat my-agent "What\'s the latest news about AI?"',
    label: "Send a test message",
  },
  {
    number: 6,
    title: "Check agent logs",
    description:
      "Every interaction is logged. The logs command shows you what happened behind the scenes during your test: the system prompt that was sent, which tools were called, token usage, and the full response chain. This is invaluable for debugging and tuning your agent.",
    code: "openclaw agent logs my-agent",
    label: "View agent logs",
  },
  {
    number: 7,
    title: "Deploy to the daemon",
    description:
      "Until now, your agent only runs when you explicitly chat with it. Deploying to the daemon makes the agent persistent. It will keep running in the background and become available through the gateway API, so other applications and services can talk to it.",
    code: "openclaw agent deploy my-agent",
    label: "Deploy the agent",
    output: "Agent deployed: my-agent\nAvailable at: http://127.0.0.1:18789/agents/my-agent",
  },
  {
    number: 8,
    title: "View in the dashboard",
    description:
      "Open your browser and navigate to the agents page on the OpenClaw dashboard. You will see your newly deployed agent listed with its name, ID, role, and status. From here you can monitor activity, update configuration, and manage the agent without touching the command line.",
    link: "http://127.0.0.1:18789/agents",
    linkLabel: "Open the agents dashboard",
  },
];

const troubleshooting = [
  {
    problem: "Agent not responding",
    solution: "openclaw agent restart my-agent",
  },
  {
    problem: "Tool not found",
    solution: "openclaw tools list",
  },
  {
    problem: "Gateway not running",
    solution: "openclaw gateway",
  },
];

export default function FirstAgentGuidePage() {
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
          Your First OpenClaw Agent
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Create, configure, and deploy a working AI agent from scratch using
          the OpenClaw CLI.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 5&ndash;10 minutes &middot; Requires: A running
          OpenClaw installation
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
