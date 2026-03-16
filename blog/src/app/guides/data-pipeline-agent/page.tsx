import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Automate ETL Pipelines with OpenClaw — The Agent Post",
  description:
    "Learn how to build an automated ETL pipeline agent with OpenClaw. Extract, transform, and load data on a schedule using TypeScript — done in 15 minutes.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Initialize a new ETL pipeline project",
    description:
      "Start by scaffolding a new OpenClaw project for automated ETL. The init command sets up the folder structure, configuration files, and a sample pipeline definition you can customize.",
    code: "openclaw init --template data-pipeline my-etl-agent",
    label: "Scaffold a pipeline project",
    output:
      "Created my-etl-agent/\n  ├── openclaw.config.ts\n  ├── pipelines/\n  ├── transforms/\n  ├── sources/\n  └── schedules/",
  },
  {
    number: 2,
    title: "Move into the project directory",
    description:
      "Change into the newly created project folder. All subsequent commands should be run from this directory.",
    code: "cd my-etl-agent",
    label: "Enter the project directory",
  },
  {
    number: 3,
    title: "Install pipeline dependencies with npm",
    description:
      "The pipeline template ships with connectors for popular data sources including PostgreSQL, CSV files, and REST APIs. Install all dependencies with a single command.",
    code: "npm install",
    label: "Install project dependencies",
    tip: "If you only need specific connectors, you can install them individually later with npm install @openclaw/connector-postgres, for example.",
  },
  {
    number: 4,
    title: "Connect to a PostgreSQL data source",
    description:
      "Define where your agent should pull data from by creating a source configuration. Here's how to set up a PostgreSQL database connection:",
    code: `openclaw source add postgres \\
  --host localhost \\
  --port 5432 \\
  --database sales_db \\
  --name my-sales-source`,
    label: "Register a PostgreSQL source",
    output: "Source 'my-sales-source' added\nConnection verified ✓",
    tip: "Credentials are stored in your local OpenClaw vault. They never leave your machine unless you explicitly export them.",
  },
  {
    number: 5,
    title: "Define the data extraction query",
    description:
      "Create an extraction config that specifies which data to pull and when. The extract command generates a file in the pipelines/ directory. This example uses incremental extraction, pulling only records created since the last run.",
    code: `openclaw pipeline extract \\
  --source my-sales-source \\
  --query "SELECT id, amount, region, created_at FROM orders WHERE created_at > :last_run" \\
  --name daily-orders`,
    label: "Create an extraction step",
  },
  {
    number: 6,
    title: "Write a TypeScript transform function",
    description:
      "Transforms are TypeScript functions that clean, reshape, or enrich your extracted data. Use them for data cleaning and normalization between the extract and load steps. Create a transform in the transforms/ directory:",
    code: `cat transforms/normalize-orders.ts

import { Transform } from "@openclaw/sdk";

export const normalizeOrders: Transform = (record) => ({
  order_id: record.id,
  amount_cents: Math.round(record.amount * 100),
  region: record.region.toUpperCase().trim(),
  order_date: new Date(record.created_at).toISOString().split("T")[0],
});`,
    label: "transforms/normalize-orders.ts",
    tip: "Transforms are pure functions — no side effects. This makes them easy to test and debug.",
  },
  {
    number: 7,
    title: "Attach the transform to your ETL pipeline",
    description:
      "Register your transform function with the extraction step. The agent will apply it to every record before loading.",
    code: `openclaw pipeline transform \\
  --pipeline daily-orders \\
  --fn transforms/normalize-orders.ts:normalizeOrders`,
    label: "Attach the transform to the pipeline",
    output: "Transform 'normalizeOrders' attached to pipeline 'daily-orders'",
  },
  {
    number: 8,
    title: "Configure the data load destination",
    description:
      "Tell the agent where to send the transformed data. Destinations can include databases, data warehouses, CSV exports, or API endpoints. Here we'll load into a local SQLite database for simplicity:",
    code: `openclaw pipeline load \\
  --pipeline daily-orders \\
  --destination sqlite:///./output/orders.db \\
  --table cleaned_orders \\
  --mode upsert \\
  --key order_id`,
    label: "Set up the load destination",
  },
  {
    number: 9,
    title: "Test the ETL pipeline with a dry run",
    description:
      "Before scheduling anything, validate the full pipeline by running it in dry-run mode. This executes extract, transform, and load but rolls back the final write so you can verify the output without committing data.",
    code: "openclaw pipeline run daily-orders --dry-run --verbose",
    label: "Dry run the pipeline",
    output:
      "Extracting from 'my-sales-source'... 1,247 records\nTransforming with 'normalizeOrders'... 1,247 records OK\nLoading to 'cleaned_orders' (dry run)... would upsert 1,247 rows\n\nPipeline 'daily-orders' dry run complete ✓",
  },
  {
    number: 10,
    title: "Schedule the pipeline",
    description:
      "Set the agent to run your pipeline automatically. Schedules use standard cron syntax. The agent daemon handles retries and logs each run for you.",
    code: `openclaw schedule add \\
  --pipeline daily-orders \\
  --cron "0 6 * * *" \\
  --retry 3 \\
  --name morning-sync`,
    label: "Schedule daily runs at 6 AM",
    output: "Schedule 'morning-sync' created\nNext run: tomorrow at 06:00",
    tip: "Use openclaw schedule list to see all active schedules and their next run times.",
  },
  {
    number: 11,
    title: "Monitor pipeline runs",
    description:
      "Check on your agent's work with the logs command. It shows status, row counts, duration, and any errors for each run. You can also view this in the OpenClaw dashboard.",
    code: "openclaw pipeline logs daily-orders --last 5",
    label: "View recent pipeline runs",
    output:
      "Run #3  2026-03-15 06:00  ✓ 1,312 rows  2.4s\nRun #2  2026-03-14 06:00  ✓ 1,247 rows  2.1s\nRun #1  2026-03-13 06:00  ✓ 1,189 rows  1.9s",
  },
];

const troubleshooting = [
  {
    problem: "\"Connection refused\" when adding a source",
    solution:
      "Verify the database is running and the host/port are correct:\n  openclaw source test my-sales-source",
  },
  {
    problem: "Transform errors on unexpected null values",
    solution:
      "Add null checks in your transform function, or filter nulls at the extraction query level with a WHERE clause.",
  },
  {
    problem: "Scheduled runs are not executing",
    solution:
      "Make sure the OpenClaw daemon is running:\n  openclaw daemon status\n  openclaw daemon start",
  },
];

export default function DataPipelineAgentGuidePage() {
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
          Extract data from a source, transform it with TypeScript functions,
          and load it into a destination &mdash; all managed by an autonomous
          agent.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: Node.js 18+
          and a running data source
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
