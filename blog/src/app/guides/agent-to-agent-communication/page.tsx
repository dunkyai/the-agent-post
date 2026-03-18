import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title:
    "How to Set Up Agent-to-Agent Communication in OpenClaw",
  description:
    "Learn how to set up agent-to-agent communication in OpenClaw. Create message channels, configure protocols, and connect your agents in under 15 minutes.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Verify your OpenClaw gateway is running",
    description:
      "Before configuring agent-to-agent communication, you need a working OpenClaw installation with the gateway running. Open your terminal and check the gateway status. You should see a green \"running\" indicator confirming the gateway is ready to route messages.",
    code: "openclaw status",
    label: "Check OpenClaw status",
    output:
      "Gateway:  running (port 18789)\nDaemon:   running (pid 48201)\nAgents:   1 active",
    tip: 'If the gateway isn\'t running, start it with: openclaw gateway',
  },
  {
    number: 2,
    title: "Create a coordinator agent with openclaw agent create",
    description:
      "You need at least two agents to enable agent-to-agent communication. Let's create a \"coordinator\" agent that will delegate tasks to other agents. The create command scaffolds a new agent config and registers it with the OpenClaw gateway.",
    code: 'openclaw agent create \\\n  --name coordinator \\\n  --role "You are a coordinator agent. You break tasks into subtasks and delegate them to specialist agents."',
    label: "Create the coordinator agent",
    output: "Agent created: coordinator (agent_01JQ7R)",
  },
  {
    number: 3,
    title: "Create a researcher agent for task delegation",
    description:
      "Now create a \"researcher\" agent that will receive delegated tasks from the coordinator. This second agent specializes in looking things up and returning structured summaries.",
    code: 'openclaw agent create \\\n  --name researcher \\\n  --role "You are a research agent. You receive topics, search for information, and return concise summaries."',
    label: "Create the researcher agent",
    output: "Agent created: researcher (agent_01JQ7S)",
  },
  {
    number: 4,
    title: "Verify both agents are registered",
    description:
      "List all registered agents to confirm both are available and ready. You should see your two agents in the output, each with a unique ID and an \"idle\" status.",
    code: "openclaw agent list",
    label: "List registered agents",
    output:
      "NAME          ID              STATUS\ncoordinator   agent_01JQ7R    idle\nresearcher    agent_01JQ7S    idle",
  },
  {
    number: 5,
    title: "Create a message channel",
    description:
      "Agents communicate through channels. A channel is a named message bus that agents can publish to and subscribe to. Create one called \"task-pipeline\" that your two agents will share.",
    code: "openclaw channel create task-pipeline",
    label: "Create a message channel",
    output: "Channel created: task-pipeline (ch_01JQ7T)",
    tip: "Channel names must be lowercase and can contain hyphens. Choose descriptive names — you'll reference them in agent configs.",
  },
  {
    number: 6,
    title: "Subscribe agents to the channel",
    description:
      "Connect both agents to the channel. The coordinator will publish messages, and the researcher will listen for them. Use the subscribe command for each agent.",
    code: "openclaw channel subscribe task-pipeline --agent coordinator --mode publish\nopenclaw channel subscribe task-pipeline --agent researcher --mode listen",
    label: "Subscribe agents to the channel",
    output:
      "coordinator subscribed to task-pipeline (publish)\nresearcher subscribed to task-pipeline (listen)",
  },
  {
    number: 7,
    title: "Set the message protocol",
    description:
      "Define how messages should be structured on this channel. OpenClaw supports several built-in protocols. The \"task-result\" protocol is ideal for delegation — it enforces a task description in the request and a structured result in the response.",
    code: "openclaw channel set-protocol task-pipeline task-result",
    label: "Set the channel protocol",
    output: "Protocol set: task-result on task-pipeline",
    tip: 'Other built-in protocols include "chat" for free-form conversation and "event-stream" for one-way notifications. Run openclaw protocol list to see all options.',
  },
  {
    number: 8,
    title: "Test the connection with a ping",
    description:
      "Before sending real tasks, verify the channel works by sending a test ping. This sends a lightweight message from the coordinator and waits for an acknowledgment from the researcher.",
    code: "openclaw channel ping task-pipeline --from coordinator --to researcher",
    label: "Ping between agents",
    output:
      "Ping sent: coordinator → researcher via task-pipeline\nAck received in 45ms",
  },
  {
    number: 9,
    title: "Send your first inter-agent message",
    description:
      "Now send a real task from the coordinator to the researcher. The send command publishes a message on the channel. The researcher agent will pick it up, process it, and send back a result.",
    code: 'openclaw send task-pipeline \\\n  --from coordinator \\\n  --body "Research the top 3 benefits of agent-to-agent communication in AI systems."',
    label: "Send a task message",
    output:
      "Message sent: msg_01JQ7U\nResponse received from researcher (msg_01JQ7V)\n\n> 1. Specialization — agents can focus on narrow tasks they're optimized for.\n> 2. Parallelism — multiple agents work simultaneously on subtasks.\n> 3. Resilience — if one agent fails, others continue operating.",
  },
  {
    number: 10,
    title: "View the message log",
    description:
      "Check the channel's message history to see the full exchange. The log shows timestamps, sender, receiver, and message contents for debugging and auditing.",
    code: "openclaw channel log task-pipeline --last 5",
    label: "View recent channel messages",
    output:
      "2026-03-17 09:41:02  coordinator → researcher  [task]    Research the top 3 benefits...\n2026-03-17 09:41:04  researcher → coordinator  [result]  1. Specialization — agents can...",
  },
  {
    number: 11,
    title: "Open the dashboard to monitor live",
    description:
      "For a visual overview, open the OpenClaw dashboard in your browser. Navigate to the Channels tab to see real-time message flow between your agents, including latency metrics and error rates.",
    link: "http://127.0.0.1:18789/channels",
    linkLabel: "Open Channels dashboard",
  },
];

const troubleshooting = [
  {
    problem: "\"No subscribers on channel\" when sending a message",
    solution:
      "openclaw channel subscribe task-pipeline --agent researcher --mode listen",
  },
  {
    problem: "Ping times out with no acknowledgment",
    solution: "openclaw agent restart researcher && openclaw channel ping task-pipeline --from coordinator --to researcher",
  },
  {
    problem: "\"Protocol mismatch\" error on send",
    solution:
      "openclaw channel set-protocol task-pipeline task-result --force",
  },
];

export default function AgentToAgentCommunicationGuidePage() {
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
          How to Set Up Agent-to-Agent Communication in OpenClaw
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Create message channels and configure protocols to connect your
          OpenClaw agents — so they can delegate tasks, share results, and
          collaborate autonomously.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: OpenClaw
          installed with gateway running
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
