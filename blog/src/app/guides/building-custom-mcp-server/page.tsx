import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Build a Custom MCP Server from Scratch — The Agent Post",
  description:
    "Learn how to build a custom MCP server with TypeScript in 15 minutes. Define tools, test with MCP Inspector, and connect to Claude Desktop or OpenClaw.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Set up your Node.js project directory",
    description:
      "Create a new folder for your MCP server project and initialize it with npm. This gives you a package.json where you'll declare your dependencies and configure the module system.",
    code: "mkdir my-mcp-server && cd my-mcp-server\nnpm init -y",
    label: "Create and initialize the project",
  },
  {
    number: 2,
    title: "Install the MCP SDK and dependencies",
    description:
      "The official Model Context Protocol SDK provides the server framework, transport layer, and TypeScript types you need. Install it along with TypeScript and the Zod validation library.",
    code: "npm install @modelcontextprotocol/sdk zod\nnpm install -D typescript @types/node",
    label: "Install dependencies",
  },
  {
    number: 3,
    title: "Configure TypeScript for your MCP server",
    description:
      "Create a tsconfig.json with the right compiler settings for an MCP server project. The key options are enabling strict mode and setting the module system to Node16 so that imports resolve correctly.",
    code: 'npx tsc --init --target ES2022 --module Node16 --moduleResolution Node16 --outDir dist --strict true',
    label: "Generate tsconfig.json",
    tip: "Make sure your package.json includes \"type\": \"module\" so Node.js treats .js files as ES modules.",
  },
  {
    number: 4,
    title: "Create the MCP server entry point",
    description:
      "Create a src directory and an index.ts file. This is where you'll set up the MCP server, register your custom tools, and start listening for requests over stdio.",
    code: "mkdir src && touch src/index.ts",
    label: "Create the source file",
  },
  {
    number: 5,
    title: "Write the MCP server boilerplate code",
    description:
      "Open src/index.ts and add the basic MCP server setup. This creates a server instance with a name and version, then connects it to stdio transport so it can communicate with any MCP-compatible client like Claude Desktop.",
    code: 'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nimport { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";\nimport { z } from "zod";\n\nconst server = new McpServer({\n  name: "my-custom-server",\n  version: "1.0.0",\n});\n\n// Tools will go here\n\nconst transport = new StdioServerTransport();\nawait server.connect(transport);',
    label: "src/index.ts — server skeleton",
  },
  {
    number: 6,
    title: "Define your first MCP tool",
    description:
      "Tools are the core of any MCP server — they're the functions an AI model can call through the client. Add a tool that takes a search query and returns results. The first argument is the tool name, the second is a description for the model, the third is a Zod schema for the input, and the fourth is the async handler function.",
    code: 'server.tool(\n  "search_docs",\n  "Search the documentation for a given query",\n  { query: z.string().describe("The search query") },\n  async ({ query }) => {\n    // Replace this with your real search logic\n    const results = await searchDocumentation(query);\n    return {\n      content: [\n        { type: "text", text: JSON.stringify(results, null, 2) },\n      ],\n    };\n  }\n);',
    label: "Add a tool definition above the transport lines",
    tip: "Give tools clear, descriptive names and descriptions. MCP clients show these to the model to help it decide which tool to call.",
  },
  {
    number: 7,
    title: "Add the shebang line and build script",
    description:
      "Add a shebang line to the top of src/index.ts so the compiled JavaScript file can run directly as an executable. Then add a build script to your package.json.",
    code: '# Add this as the very first line of src/index.ts:\n#!/usr/bin/env node\n\n# Add this to the "scripts" section of package.json:\n"build": "tsc && chmod +x dist/index.js"',
    label: "Make the server executable",
  },
  {
    number: 8,
    title: "Build and run the MCP server locally",
    description:
      "Compile your TypeScript to JavaScript and verify the MCP server starts without errors. It will wait for input on stdin — that's expected, since MCP servers communicate over stdio. Press Ctrl+C to stop it.",
    code: "npm run build\nnode dist/index.js",
    label: "Build and run",
    output: "# Server starts and waits for MCP client input\n# Press Ctrl+C to exit",
  },
  {
    number: 9,
    title: "Test with the MCP Inspector",
    description:
      "The MCP Inspector is a developer tool that lets you connect to your server and call tools interactively. It opens a web UI where you can see your tools, send requests, and inspect responses.",
    code: "npx @modelcontextprotocol/inspector node dist/index.js",
    label: "Launch the MCP Inspector",
    output: "MCP Inspector is up and running at http://localhost:5173",
  },
  {
    number: 10,
    title: "Connect to Claude or OpenClaw",
    description:
      "To use your server with Claude Desktop or OpenClaw, add it to your MCP config file. The command array tells the client how to launch your server. Use the absolute path to your compiled entry point.",
    code: '{\n  "mcpServers": {\n    "my-custom-server": {\n      "command": "node",\n      "args": ["/absolute/path/to/my-mcp-server/dist/index.js"]\n    }\n  }\n}',
    label: "Add to claude_desktop_config.json or openclaw MCP config",
    tip: "After editing the config, restart Claude Desktop or run \"openclaw mcp reload\" for the changes to take effect.",
  },
];

const troubleshooting = [
  {
    problem: "\"Cannot find module '@modelcontextprotocol/sdk/server/mcp.js'\"",
    solution:
      'Check that your tsconfig.json has "module": "Node16" and "moduleResolution": "Node16", and that package.json has "type": "module".',
  },
  {
    problem: "Server starts but no tools appear in the Inspector",
    solution:
      "Make sure your server.tool() calls are placed before the await server.connect(transport) line.",
  },
  {
    problem: "\"ERR_MODULE_NOT_FOUND\" when running node dist/index.js",
    solution: "npm install && npm run build — then verify dist/index.js exists.",
  },
];

export default function BuildingCustomMcpServerPage() {
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
          Building a Custom MCP Server from Scratch
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Create your own Model Context Protocol server with custom tools that
          any MCP client can call — from Claude Desktop to OpenClaw.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: Node.js 18+
          and a code editor
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
