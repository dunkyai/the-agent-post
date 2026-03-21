import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Build an Automated ETL Pipeline Agent — The Agent Post",
  description:
    "Learn how to build an ETL pipeline agent that extracts API data, transforms it, and loads it into PostgreSQL automatically. Step-by-step OpenClaw tutorial.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Install OpenClaw and verify your CLI setup",
    description:
      "Make sure you have OpenClaw installed and running. Check that the CLI is available and your agent gateway is active. If you haven't set up OpenClaw yet, follow the setup guide first.",
    code: "openclaw --version && openclaw status",
    label: "Check OpenClaw installation",
    output: "openclaw v0.9.4\nGateway: running on port 18789\nAgents: 0 active",
  },
  {
    number: 2,
    title: "Scaffold a new ETL pipeline project",
    description:
      "Scaffold a new agent project using the ETL template. This gives you a pre-configured directory structure with source connectors, transform functions, and a load target — all wired together and ready to customize.",
    code: "openclaw create my-etl-pipeline --template etl",
    label: "Scaffold the ETL agent",
    output: "Created project: my-etl-pipeline/\n  ├── agent.yaml\n  ├── sources/\n  ├── transforms/\n  ├── targets/\n  └── schedules/",
  },
  {
    number: 3,
    title: "Configure a REST API data source",
    description:
      "Open the agent config file and define where your data comes from. OpenClaw supports REST APIs, CSV files, databases, and S3 buckets out of the box. Here we'll configure a REST API source that pulls order data from an example endpoint.",
    code: `cd my-etl-pipeline && cat agent.yaml`,
    label: "View the default agent config",
  },
  {
    number: 4,
    title: "Define the API extraction source with authentication",
    description:
      "Edit the sources directory to add your API connector. The source config tells the agent which endpoint to hit, how to authenticate with a bearer token, and how to paginate through results using cursor-based pagination.",
    code: `cat > sources/orders.yaml << 'EOF'
source:
  name: orders-api
  type: rest
  url: https://api.example.com/v1/orders
  auth:
    type: bearer
    token_env: ORDERS_API_KEY
  pagination:
    type: cursor
    param: after
    limit: 100
  schedule: "*/30 * * * *"
EOF`,
    label: "Create the orders source config",
    tip: "Use token_env instead of hardcoding secrets. OpenClaw reads from your environment or .env file automatically.",
  },
  {
    number: 5,
    title: "Write a TypeScript transform function",
    description:
      "Transforms are plain TypeScript or JavaScript functions that receive raw extracted records and return cleaned, reshaped data. The agent calls your transform for each batch of records. Here you'll normalize order fields and calculate line-item totals.",
    code: `cat > transforms/normalize-orders.ts << 'EOF'
import { TransformFn } from "@openclaw/sdk";

const transform: TransformFn = async (records) => {
  return records.map((record) => ({
    order_id: record.id,
    customer_email: record.customer.email.toLowerCase().trim(),
    total_cents: Math.round(record.line_items.reduce(
      (sum: number, item: any) => sum + item.price * item.quantity, 0
    ) * 100),
    currency: record.currency || "USD",
    status: record.status,
    created_at: new Date(record.created_at).toISOString(),
  }));
};

export default transform;
EOF`,
    label: "Create the transform function",
  },
  {
    number: 6,
    title: "Configure PostgreSQL as the load target",
    description:
      "Define where the transformed data should land. OpenClaw can load into PostgreSQL, BigQuery, S3, or local files. Here we'll configure a PostgreSQL target with upsert mode. The agent handles connection pooling, batched inserts, and retry logic for you.",
    code: `cat > targets/postgres.yaml << 'EOF'
target:
  name: warehouse
  type: postgres
  connection_env: DATABASE_URL
  table: orders_staging
  mode: upsert
  upsert_key: order_id
  batch_size: 500
EOF`,
    label: "Create the Postgres target config",
    tip: "Use mode: upsert with an upsert_key to avoid duplicate rows on re-runs. The agent will insert new records and update existing ones.",
  },
  {
    number: 7,
    title: "Set environment variables for API and database credentials",
    description:
      "The agent needs credentials for your source API and target database. Create a .env file in your project root with your API key and PostgreSQL connection string. OpenClaw loads these automatically when the agent starts.",
    code: `cat > .env << 'EOF'
ORDERS_API_KEY=your-api-key-here
DATABASE_URL=postgres://user:password@localhost:5432/warehouse
EOF`,
    label: "Create the .env file",
    tip: "Never commit .env files to git. The ETL template includes a .gitignore that excludes it by default.",
  },
  {
    number: 8,
    title: "Wire the extract-transform-load pipeline in agent.yaml",
    description:
      "Update agent.yaml to connect your source, transform, and target into a single ETL pipeline. The agent reads this config to understand the full data flow — what to extract, how to transform it, and where to load the result.",
    code: `cat > agent.yaml << 'EOF'
agent:
  name: orders-etl
  description: "Extract orders, normalize fields, load to warehouse"

pipeline:
  - extract: sources/orders.yaml
  - transform: transforms/normalize-orders.ts
  - load: targets/postgres.yaml

settings:
  retry:
    max_attempts: 3
    backoff: exponential
  logging:
    level: info
    destination: stdout
EOF`,
    label: "Define the pipeline in agent.yaml",
  },
  {
    number: 9,
    title: "Run the pipeline locally",
    description:
      "Test your pipeline with a dry run first. This executes the full extract-transform-load flow but writes results to stdout instead of your database, so you can inspect the output before committing to a real load.",
    code: "openclaw run --dry-run",
    label: "Dry-run the pipeline",
    output: "Extracting from orders-api... 247 records\nTransforming with normalize-orders... 247 records\nDry run — skipping load to warehouse\n\nSample output (first 3 records):\n  { order_id: \"ord_8a1f\", customer_email: \"alice@example.com\", total_cents: 4999, ... }\n  { order_id: \"ord_3b2c\", customer_email: \"bob@example.com\", total_cents: 12450, ... }\n  { order_id: \"ord_9d4e\", customer_email: \"carol@example.com\", total_cents: 780, ... }",
  },
  {
    number: 10,
    title: "Execute a real pipeline run",
    description:
      "Once you're happy with the dry run output, execute the pipeline for real. The agent will extract data from your API, run your transform, and upsert the results into PostgreSQL.",
    code: "openclaw run",
    label: "Run the full pipeline",
    output: "Extracting from orders-api... 247 records\nTransforming with normalize-orders... 247 records\nLoading to warehouse (postgres)... 247 rows upserted\n\nPipeline complete in 3.2s",
  },
  {
    number: 11,
    title: "Deploy and schedule the agent",
    description:
      "Deploy the agent to run on the OpenClaw gateway so it executes on its cron schedule automatically. Once deployed, the agent will pull new orders every 30 minutes without any manual intervention.",
    code: "openclaw deploy",
    label: "Deploy the pipeline agent",
    output: "Deployed: orders-etl\nSchedule: */30 * * * * (every 30 minutes)\nNext run: 2026-03-21T14:30:00Z",
    tip: "View run history and logs anytime with: openclaw logs orders-etl --tail",
  },
];

const troubleshooting = [
  {
    problem: "\"Connection refused\" when loading to PostgreSQL",
    solution: "Make sure your database is running and the DATABASE_URL in .env is correct. Test with: psql $DATABASE_URL -c 'SELECT 1'",
  },
  {
    problem: "Transform fails with \"Cannot read property of undefined\"",
    solution: "Run openclaw run --dry-run --verbose to inspect raw source records. Your transform may reference a field that doesn't exist in the API response.",
  },
  {
    problem: "Agent deploys but never runs on schedule",
    solution: "openclaw doctor --check-schedules",
  },
];

export default function DataPipelineEtlGuidePage() {
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
          Building a Data Pipeline Agent for ETL Tasks
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Build an AI agent that extracts data from an API, transforms it with
          custom logic, and loads it into PostgreSQL — all running on autopilot.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: OpenClaw
          installed, a REST API source, PostgreSQL
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
