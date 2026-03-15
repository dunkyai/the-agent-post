import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Multi-Agent Content Pipeline with OpenClaw — The Agent Post",
  description:
    "Learn how to build a multi-agent content pipeline with OpenClaw. Chain writer, editor, and publisher AI agents to automate article creation step by step.",
};

const steps: {
  number: number;
  title: string;
  description: string;
  code?: string;
  label?: string;
  output?: string;
  tip?: string;
  link?: string;
  linkLabel?: string;
}[] = [
  {
    number: 1,
    title: "Verify your OpenClaw installation is running",
    description:
      "Before building your multi-agent content pipeline, confirm that OpenClaw is installed and the gateway is running. You should see a clean status summary with no errors.",
    code: "openclaw status",
    label: "Check OpenClaw status",
    output:
      "Gateway: running (port 18789)\nDaemon: active\nAgents: 0 running, 0 paused",
    tip: "If the gateway isn't running, start it with: openclaw gateway",
  },
  {
    number: 2,
    title: "Create an OpenClaw workspace for the content pipeline",
    description:
      "OpenClaw workspaces keep related agents organized. Create a dedicated workspace for your content pipeline. This generates a folder with a manifest file where all your agent definitions will live.",
    code: "openclaw workspace create content-pipeline",
    label: "Create a workspace",
    output:
      "Created workspace: content-pipeline\nManifest: ~/.openclaw/workspaces/content-pipeline/manifest.yaml",
  },
  {
    number: 3,
    title: "Define the writer agent with a system prompt",
    description:
      "The writer is the first AI agent in your content pipeline. It takes a topic and produces a raw draft. The --role flag sets the system prompt, and --output-format tells it to emit structured JSON so downstream agents can parse the result.",
    code: `openclaw agent create writer \\
  --workspace content-pipeline \\
  --role "You are a technical writer. Given a topic, produce a well-structured first draft with a title, introduction, body sections, and conclusion." \\
  --output-format json \\
  --model claude-sonnet-4-6`,
    label: "Create the writer agent",
  },
  {
    number: 4,
    title: "Chain the editor agent to the writer",
    description:
      "The editor agent receives the writer's draft and improves it — tightening prose, fixing grammar, and ensuring a consistent tone. The --input-from flag chains it to the writer's output, creating your first agent-to-agent connection.",
    code: `openclaw agent create editor \\
  --workspace content-pipeline \\
  --role "You are a sharp editor. Revise the draft for clarity, grammar, and tone. Preserve the author's intent but make every sentence earn its place." \\
  --input-from writer \\
  --output-format json \\
  --model claude-sonnet-4-6`,
    label: "Create the editor agent",
  },
  {
    number: 5,
    title: "Add a publisher agent for Markdown output",
    description:
      "The publisher agent takes the edited draft, formats it as Markdown, generates YAML front matter (title, description, tags), and writes the final file to disk. The --output-dir flag controls where your automated content output lands.",
    code: `openclaw agent create publisher \\
  --workspace content-pipeline \\
  --role "You are a publisher. Take the edited article and format it as a complete Markdown file with YAML front matter including title, description, date, and tags." \\
  --input-from editor \\
  --output-dir ./output \\
  --model claude-haiku-4-5`,
    label: "Create the publisher agent",
    tip: "The publisher uses a faster model since its task is mostly formatting, not creative writing. This keeps costs down.",
  },
  {
    number: 6,
    title: "Preview the multi-agent workflow graph",
    description:
      "Before running anything, visualize your agent pipeline to confirm all three agents are wired correctly. You should see the full chain: writer → editor → publisher.",
    code: "openclaw workflow preview content-pipeline",
    label: "Preview the agent pipeline",
    output:
      "content-pipeline\n  writer (claude-sonnet-4-6)\n    → editor (claude-sonnet-4-6)\n      → publisher (claude-haiku-4-5)\n\n3 agents, 2 connections",
  },
  {
    number: 7,
    title: "Run the content pipeline end to end",
    description:
      "Trigger the full multi-agent pipeline by passing a topic to the workspace. The --watch flag streams each agent's progress to your terminal in real time so you can see the content evolve from draft to finished article.",
    code: `openclaw workflow run content-pipeline \\
  --input "How to build your first MCP server" \\
  --watch`,
    label: "Run the content pipeline",
    output:
      '[writer]    Generating draft...\n[writer]    Done (1,240 tokens)\n[editor]    Revising draft...\n[editor]    Done (1,180 tokens)\n[publisher] Formatting output...\n[publisher] Saved to ./output/how-to-build-your-first-mcp-server.md\n\nWorkflow complete — 3/3 agents finished',
  },
  {
    number: 8,
    title: "Debug and inspect agent output logs",
    description:
      "To see exactly what each agent produced, use the OpenClaw logs command. This is useful for debugging your multi-agent workflow when an agent's output isn't what you expected.",
    code: "openclaw logs content-pipeline --agent editor --last 1",
    label: "View the editor's last output",
    tip: "Add --raw to see the full JSON payload including token counts and latency.",
  },
  {
    number: 9,
    title: "Add a quality gate between agents (optional)",
    description:
      "You can insert a review step that scores the editor's output and loops it back for another revision if quality is below a threshold. The --gate flag adds a conditional check between any two agents in your pipeline.",
    code: `openclaw gate add content-pipeline \\
  --after editor \\
  --check "Rate this article 1-10 for clarity and completeness. Return PASS if 7 or above, FAIL otherwise." \\
  --on-fail retry \\
  --max-retries 2`,
    label: "Add a quality gate",
  },
  {
    number: 10,
    title: "Schedule automated content runs with cron",
    description:
      "Once your multi-agent workflow is reliable, schedule it to run automatically on a cron. This example runs the content pipeline every weekday at 9 AM with a different topic pulled from a topics file.",
    code: `openclaw workflow schedule content-pipeline \\
  --cron "0 9 * * 1-5" \\
  --input-file ./topics.txt \\
  --rotate`,
    label: "Schedule daily content runs",
    tip: "The --rotate flag picks the next unused topic from the file each run, so you won't get duplicates.",
  },
];

const troubleshooting = [
  {
    problem: "\"No agents found in workspace\" error when running the pipeline",
    solution:
      "openclaw workspace list content-pipeline\n# If empty, re-create agents with the --workspace flag",
  },
  {
    problem: "Editor agent produces empty output",
    solution:
      'openclaw agent update editor --workspace content-pipeline --output-format json\n# Ensure --output-format matches what the next agent expects',
  },
  {
    problem: "Quality gate always returns FAIL",
    solution:
      "openclaw logs content-pipeline --agent editor --last 1 --raw\n# Review the output, then adjust the gate threshold or editor prompt",
  },
];

export default function MultiAgentContentWorkflowPage() {
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
          Build a Multi-Agent Content Pipeline with OpenClaw
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Chain writer, editor, and publisher AI agents into an automated
          pipeline that turns a single topic into a publish-ready article.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: OpenClaw
          installed with a valid API key
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
