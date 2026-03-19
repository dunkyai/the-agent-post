import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Connect OpenClaw to PostgreSQL via MCP — The Agent Post",
  description:
    "Learn how to connect OpenClaw to PostgreSQL using MCP in 10 minutes. Install Postgres, configure the MCP server, and query your database from an agent.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Install PostgreSQL with Homebrew",
    description:
      "If you don't already have PostgreSQL running locally, install it with Homebrew on macOS. This gives you the PostgreSQL 16 database server, the psql command-line client, and all the tools you need.",
    code: "brew install postgresql@16",
    label: "Install PostgreSQL 16",
    tip: "Already have Postgres? Skip to step 3. You can check with: psql --version",
  },
  {
    number: 2,
    title: "Start the PostgreSQL service on macOS",
    description:
      "Tell Homebrew to start the PostgreSQL service now and automatically on every reboot. Once it's running, you should be able to connect with psql.",
    code: "brew services start postgresql@16",
    label: "Start PostgreSQL",
    output: "==> Successfully started `postgresql@16`",
  },
  {
    number: 3,
    title: "Create a new PostgreSQL database",
    description:
      "Create a dedicated PostgreSQL database that your OpenClaw agents will read from and write to. You can name it whatever you like — we'll use \"openclaw_data\" here.",
    code: "createdb openclaw_data",
    label: "Create the database",
  },
  {
    number: 4,
    title: "Verify the database connection with psql",
    description:
      "Connect to the new database with psql to confirm everything is working. You should land in an interactive PostgreSQL prompt. Type \\q to exit when you're done.",
    code: "psql openclaw_data",
    label: "Connect to the database",
    output: "psql (16.x)\nType \"help\" for help.\n\nopenclaw_data=#",
  },
  {
    number: 5,
    title: "Install the PostgreSQL MCP server with npm",
    description:
      "MCP (Model Context Protocol) servers give your AI agents access to external tools and data sources. The community PostgreSQL MCP server lets agents run SQL queries against your database. Install it globally with npm.",
    code: "npm install -g @modelcontextprotocol/server-postgres",
    label: "Install the MCP server package",
  },
  {
    number: 6,
    title: "Test the MCP server connection to PostgreSQL",
    description:
      "Before wiring it into OpenClaw, verify the MCP server can connect to your PostgreSQL database. Pass your connection string as an argument. You should see it start up and list available tools. Press Ctrl+C to stop it.",
    code: "mcp-server-postgres postgresql://localhost/openclaw_data",
    label: "Test the MCP server connection",
    tip: "If you set a password for your Postgres user, use: postgresql://user:password@localhost/openclaw_data",
  },
  {
    number: 7,
    title: "Add the PostgreSQL MCP server to OpenClaw",
    description:
      "Now register your PostgreSQL MCP server with OpenClaw. The add command saves it to your agent configuration so any OpenClaw agent can use it. Give it a clear name — your agents will see this when they list available tools.",
    code: "openclaw mcp add postgres-db \\\n  --transport stdio \\\n  --command mcp-server-postgres \\\n  --args postgresql://localhost/openclaw_data",
    label: "Register the MCP server",
    output: "MCP server 'postgres-db' registered\nTools available: query, list_tables, describe_table",
  },
  {
    number: 8,
    title: "Verify the MCP server is registered in OpenClaw",
    description:
      "List all registered MCP servers to make sure yours shows up. You should see \"postgres-db\" in the output with a status of \"ready\".",
    code: "openclaw mcp list",
    label: "List MCP servers",
    output: "NAME           TRANSPORT  STATUS\npostgres-db    stdio      ready",
  },
  {
    number: 9,
    title: "Seed some test data",
    description:
      "Give your agent something to work with. This command creates a sample table and inserts a few rows. You can swap this for your own schema later.",
    code: "psql openclaw_data -c \"\nCREATE TABLE customers (\n  id SERIAL PRIMARY KEY,\n  name TEXT NOT NULL,\n  email TEXT NOT NULL,\n  plan TEXT DEFAULT 'free'\n);\nINSERT INTO customers (name, email, plan) VALUES\n  ('Alice Park', 'alice@example.com', 'pro'),\n  ('Bob Chen', 'bob@example.com', 'free'),\n  ('Carol Liu', 'carol@example.com', 'enterprise');\n\"",
    label: "Create a table and insert sample data",
  },
  {
    number: 10,
    title: "Ask your agent to query the database",
    description:
      "Start an OpenClaw agent session and ask it to use the database. The agent will discover the PostgreSQL tools via MCP and run queries to answer your question.",
    code: "openclaw agent chat --tools postgres-db",
    label: "Launch an agent with database access",
    tip: "Try prompting: \"List all customers on the pro plan\" — the agent will write and execute the SQL for you.",
  },
];

const troubleshooting = [
  {
    problem: "\"connection refused\" when connecting to PostgreSQL",
    solution:
      "brew services restart postgresql@16",
  },
  {
    problem: "\"mcp-server-postgres: command not found\" after install",
    solution:
      "npm list -g @modelcontextprotocol/server-postgres\n# If missing, reinstall. If present, check your PATH includes the npm global bin:\nnpm config get prefix",
  },
  {
    problem: "Agent says \"no tools available\" when chatting",
    solution:
      "openclaw mcp list\n# If status is 'error', re-register the server:\nopenclaw mcp remove postgres-db\nopenclaw mcp add postgres-db --transport stdio --command mcp-server-postgres --args postgresql://localhost/openclaw_data",
  },
];

export default function PostgresMcpGuidePage() {
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
          Connecting OpenClaw to PostgreSQL via MCP
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Give your agents read and write access to a PostgreSQL database
          using the Model Context Protocol.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: macOS,
          OpenClaw installed, admin access
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
