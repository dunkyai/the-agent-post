import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Connecting MCP Servers to OpenClaw — The Agent Post",
  description:
    "Step-by-step guide to connecting MCP (Model Context Protocol) servers to OpenClaw. Give your AI agents access to Slack, GitHub, databases, and more.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Understand MCP",
    description:
      "MCP (Model Context Protocol) is a protocol that lets AI agents talk to external services through \"tool servers.\" Each MCP server exposes a set of tools that your agent can call — reading Slack messages, creating GitHub issues, querying databases, searching the web, and more. Think of MCP servers as plugins that give your agents superpowers beyond text generation.",
  },
  {
    number: 2,
    title: "Browse available servers",
    description:
      "OpenClaw ships with a registry of pre-built MCP servers. Use the list command to see what's available. You'll see servers for Slack, GitHub, file system access, web search, databases, and more.",
    code: "openclaw mcp list",
    label: "List available MCP servers",
  },
  {
    number: 3,
    title: "Install an MCP server",
    description:
      "Pick a server from the registry and install it. This downloads the server binary, creates a default configuration file, and registers it with your local OpenClaw installation. We'll use Slack as an example.",
    code: "openclaw mcp install slack",
    label: "Install the Slack MCP server",
  },
  {
    number: 4,
    title: "Configure credentials",
    description:
      "Most MCP servers need credentials to connect to the external service. The configure command launches an interactive prompt that asks for the required values. For Slack, you'll need a Slack API token (Bot User OAuth Token) and your workspace URL. You can create a Slack app and get a token at api.slack.com/apps.",
    code: "openclaw mcp configure slack",
    label: "Configure Slack credentials",
    link: "https://api.slack.com/apps",
    linkLabel: "Slack API: Create an app",
    tip: "Store your tokens securely. OpenClaw encrypts credentials at rest, but never commit them to version control.",
  },
  {
    number: 5,
    title: "Attach to an agent",
    description:
      "Now connect the MCP server to one of your agents. Once attached, the agent can discover and call any tool the server exposes. For Slack, that means reading channels, sending messages, searching history, and more.",
    code: "openclaw agent add-mcp my-agent slack",
    label: "Attach Slack MCP server to your agent",
  },
  {
    number: 6,
    title: "Test the connection",
    description:
      "Verify that the MCP server is running and the credentials work. The test command starts the server, attempts to authenticate with the external service, and reports the result.",
    code: "openclaw mcp test slack",
    label: "Test the Slack MCP server",
    output: "Slack MCP server is running\nAuthentication successful\n3 tools available: read_channel, send_message, search_messages",
  },
  {
    number: 7,
    title: "Add multiple servers",
    description:
      "Agents aren't limited to one MCP server. You can install and attach as many as you need. Chain the commands to set up multiple servers at once. An agent with Slack and GitHub access can, for example, read a Slack request and automatically create a GitHub issue.",
    code: "openclaw mcp install github && openclaw agent add-mcp my-agent github",
    label: "Install and attach GitHub in one step",
  },
  {
    number: 8,
    title: "View connected servers",
    description:
      "Use the agent info command to see which MCP servers are currently attached to an agent, along with the tools each server provides and their connection status.",
    code: "openclaw agent info my-agent",
    label: "View agent details and connected MCP servers",
    output: "Agent: my-agent\nStatus: running\n\nMCP Servers:\n  slack    — 3 tools — connected\n  github   — 5 tools — connected",
  },
  {
    number: 9,
    title: "Custom MCP servers",
    description:
      "If the registry doesn't have what you need, you can build your own MCP server. The create command scaffolds a new server project from a template. Edit the generated handler file to define your custom tools, then install it locally like any other server.",
    code: "openclaw mcp create my-server --template basic",
    label: "Scaffold a custom MCP server",
    tip: "Check the MCP specification at modelcontextprotocol.io for the full protocol reference.",
  },
];

const troubleshooting = [
  {
    problem: "MCP server failed to start",
    solution: "openclaw mcp logs slack",
  },
  {
    problem: "Authentication failed",
    solution: "openclaw mcp configure slack",
  },
  {
    problem: "Agent can't find the tool",
    solution: "openclaw agent restart my-agent",
  },
];

export default function McpServersGuidePage() {
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
          Connecting MCP Servers to OpenClaw
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Give your AI agents access to external tools like Slack, GitHub,
          databases, and more using the Model Context Protocol.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: A running
          OpenClaw installation with at least one agent
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
