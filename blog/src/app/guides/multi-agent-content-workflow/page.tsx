import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title:
    "Build a Multi-Agent Content Pipeline | OpenClaw — The Agent Post",
  description:
    "Learn how to build a multi-agent content pipeline with OpenClaw. Chain researcher, writer, editor, and SEO agents to produce publish-ready articles automatically.",
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
    title: "Verify your OpenClaw installation and gateway status",
    description:
      "Before wiring up any agents, confirm your OpenClaw installation is healthy and the gateway is online. Run the status command and check for errors. If the gateway shows as stopped, start it first.",
    code: "openclaw status",
    label: "Check OpenClaw status",
    output:
      "Gateway: running (port 18789)\nDaemon: active\nAgents: 0 running, 0 paused",
    tip: 'If the gateway is stopped, run "openclaw gateway" in a separate terminal tab first.',
  },
  {
    number: 2,
    title: "Create an OpenClaw workspace for your content pipeline",
    description:
      "OpenClaw workspaces group related agents into a single project. Create one called content-crew. This generates a manifest file where your agent definitions, connections, and environment variables are stored.",
    code: "openclaw workspace create content-crew",
    label: "Create a workspace",
    output:
      "Created workspace: content-crew\nManifest: ~/.openclaw/workspaces/content-crew/manifest.yaml",
  },
  {
    number: 3,
    title: "Create a researcher agent to generate topic briefs",
    description:
      "The researcher is the first agent in your content pipeline. Given a topic, it produces a structured brief with key points, audience notes, and a suggested outline. Using --output-format json ensures downstream agents can parse its output cleanly.",
    code: `openclaw agent create researcher \\
  --workspace content-crew \\
  --role "You are a research assistant. Given a topic, produce a JSON brief containing: key_points (5-7 bullet points), target_audience, suggested_outline (with section headings), and tone_guidance." \\
  --output-format json \\
  --model claude-sonnet-4-6`,
    label: "Create the researcher agent",
  },
  {
    number: 4,
    title: "Chain a writer agent to the researcher with input piping",
    description:
      "The writer agent receives the researcher's brief and expands it into a full article draft. The --input-from flag connects these two agents — it tells OpenClaw to pipe the researcher's output directly into the writer's context as input.",
    code: `openclaw agent create writer \\
  --workspace content-crew \\
  --role "You are a technical writer. Using the research brief provided, write a complete article draft with an engaging introduction, clearly structured body sections following the suggested outline, and a concise conclusion. Write in a conversational but authoritative tone." \\
  --input-from researcher \\
  --output-format json \\
  --model claude-sonnet-4-6`,
    label: "Create the writer agent",
    tip: "Both the researcher and writer use Sonnet for the best balance of quality and speed. You can swap in Opus for higher-stakes content.",
  },
  {
    number: 5,
    title: "Add an editor agent to revise and polish drafts",
    description:
      "The editor agent reads the writer's draft and improves it — tightening sentences, fixing inconsistencies, and polishing transitions. Chaining it with --input-from writer creates the second link in your multi-agent pipeline.",
    code: `openclaw agent create editor \\
  --workspace content-crew \\
  --role "You are a meticulous editor. Revise the article for clarity, grammar, flow, and factual consistency. Cut filler. Strengthen weak openings. Ensure every paragraph earns its place. Return the revised article in the same JSON structure." \\
  --input-from writer \\
  --output-format json \\
  --model claude-sonnet-4-6`,
    label: "Create the editor agent",
  },
  {
    number: 6,
    title: "Add an SEO agent for metadata and Markdown output",
    description:
      "The final agent in the chain takes the polished article and generates SEO metadata — a meta description, Open Graph title, slug, and keyword tags. It also converts the article body into clean Markdown with YAML front matter, ready to publish.",
    code: `openclaw agent create seo-formatter \\
  --workspace content-crew \\
  --role "You are an SEO specialist and formatter. Take the edited article and produce a final Markdown file with YAML front matter containing: title, slug, meta_description (under 160 chars), og_title, tags (3-5 keywords), and date. Format the body as clean Markdown." \\
  --input-from editor \\
  --output-dir ./output \\
  --model claude-haiku-4-5`,
    label: "Create the SEO formatter agent",
    tip: "The SEO formatter uses Haiku since its job is mostly structural — formatting and metadata extraction. This keeps the cost of each pipeline run low.",
  },
  {
    number: 7,
    title: "Preview the multi-agent pipeline graph",
    description:
      "Before running anything, verify that all four agents are connected in the right order. The preview command prints your content pipeline as a visual graph so you can spot broken links or missing connections.",
    code: "openclaw workflow preview content-crew",
    label: "Preview the agent pipeline",
    output:
      "content-crew\n  researcher (claude-sonnet-4-6)\n    → writer (claude-sonnet-4-6)\n      → editor (claude-sonnet-4-6)\n        → seo-formatter (claude-haiku-4-5)\n\n4 agents, 3 connections",
  },
  {
    number: 8,
    title: "Run the content pipeline end to end",
    description:
      "Trigger the full multi-agent workflow by passing a topic string. The --watch flag streams each agent's progress to your terminal in real time, so you can see content move from research brief to finished article.",
    code: `openclaw workflow run content-crew \\
  --input "A beginner's guide to prompt engineering" \\
  --watch`,
    label: "Run the full content pipeline",
    output:
      "[researcher]     Generating brief...\n[researcher]     Done (820 tokens)\n[writer]         Drafting article...\n[writer]         Done (1,450 tokens)\n[editor]         Revising draft...\n[editor]         Done (1,380 tokens)\n[seo-formatter]  Formatting output...\n[seo-formatter]  Saved to ./output/beginners-guide-to-prompt-engineering.md\n\nWorkflow complete — 4/4 agents finished",
  },
  {
    number: 9,
    title: "Inspect individual agent outputs",
    description:
      "If the final article doesn't look right, trace the issue back to the responsible agent. The logs command lets you inspect what any single agent produced during the last run. This is the fastest way to debug a multi-agent workflow.",
    code: "openclaw logs content-crew --agent writer --last 1",
    label: "View the writer's last output",
    tip: "Add --raw to see the full JSON payload with token counts, latency, and the exact prompt that was sent.",
  },
  {
    number: 10,
    title: "Add a quality gate between the editor and formatter",
    description:
      "Quality gates let you insert an automated review step between any two agents. This gate scores the editor's output and retries the revision if quality drops below a threshold — preventing low-quality drafts from reaching the formatting stage.",
    code: `openclaw gate add content-crew \\
  --after editor \\
  --check "Score this article 1-10 on clarity, structure, and engagement. Return PASS if 7 or above, FAIL with specific feedback otherwise." \\
  --on-fail retry \\
  --max-retries 2`,
    label: "Add a quality gate",
    tip: "Quality gates add a small cost per run but dramatically improve consistency when producing content at scale.",
  },
  {
    number: 11,
    title: "Batch-run the pipeline with multiple topics",
    description:
      "Once your workflow is producing solid results, run it against a list of topics in one command. Create a plain text file with one topic per line, then use --input-file to process them all. OpenClaw runs each topic through the full pipeline sequentially.",
    code: `cat <<'EOF' > topics.txt
How to choose the right LLM for your use case
Building AI agents that use external tools
What is retrieval-augmented generation (RAG)
EOF

openclaw workflow batch content-crew \\
  --input-file topics.txt \\
  --output-dir ./output`,
    label: "Batch-run with a topics file",
    output:
      "Queued 3 topics\n[1/3] How to choose the right LLM... ✓\n[2/3] Building AI agents that use... ✓\n[3/3] What is retrieval-augmented... ✓\n\nBatch complete — 3 articles saved to ./output/",
  },
];

const troubleshooting = [
  {
    problem: "\"No agents found in workspace\" when running the workflow",
    solution:
      "openclaw workspace list content-crew\n# If empty, recreate agents making sure to pass --workspace content-crew",
  },
  {
    problem: "An agent produces empty or malformed output",
    solution:
      "openclaw logs content-crew --agent <name> --last 1 --raw\n# Check that --output-format json is set on the upstream agent",
  },
  {
    problem: "Quality gate always returns FAIL and retries are exhausted",
    solution:
      "openclaw gate update content-crew --after editor --max-retries 3\n# Or lower the threshold by editing the --check prompt to be less strict",
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
          Creating a Multi-Agent Workflow for Content Creation
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Wire up researcher, writer, editor, and SEO agents into a single
          automated pipeline that turns any topic into a publish-ready article.
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
