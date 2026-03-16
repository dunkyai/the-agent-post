import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Build a Web Scraping Agent with OpenClaw — The Agent Post",
  description:
    "Learn how to build and schedule an OpenClaw web scraping agent in 10 minutes. Extract structured data from any website with this step-by-step tutorial.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Verify your OpenClaw installation",
    description:
      "Before building your web scraping agent, confirm that OpenClaw is installed and running on your machine. You should see a version number like \"0.9.x\" or higher.",
    code: "openclaw --version",
    label: "Check OpenClaw version",
    tip: "If you don't have OpenClaw yet, follow our OpenClaw Setup Guide first.",
  },
  {
    number: 2,
    title: "Install the OpenClaw web scraping plugin",
    description:
      "OpenClaw ships with an official web scraping plugin that gives your agents the ability to fetch pages, parse HTML, and extract structured data. Install it from the OpenClaw plugin registry.",
    code: "openclaw plugin install @openclaw/scraper",
    label: "Install the scraper plugin",
    output:
      "✓ @openclaw/scraper@1.4.2 installed\n✓ Tools registered: fetch_page, extract_content, screenshot",
  },
  {
    number: 3,
    title: "Create a new web scraping agent",
    description:
      "Scaffold a new agent project using the built-in research template. This gives you a pre-configured web scraping agent with page fetching, content extraction, and a structured JSON output schema.",
    code: "openclaw agent create my-research-agent --template research",
    label: "Scaffold a research agent",
    output:
      "Created agent: my-research-agent\nDirectory: ./my-research-agent\nTemplate: research",
  },
  {
    number: 4,
    title: "Review the agent.yaml configuration",
    description:
      "Open the generated agent.yaml configuration file. This is where you define your agent's behavior — its goal, the scraping tools it can use, and how it should format extracted results. The research template comes with sensible defaults.",
    code: "cat my-research-agent/agent.yaml",
    label: "View the agent config",
    output:
      'name: my-research-agent\ntemplate: research\nmodel: claude-sonnet\ntools:\n  - fetch_page\n  - extract_content\n  - screenshot\noutput:\n  format: json\n  schema: results.schema.json',
  },
  {
    number: 5,
    title: "Define target URLs and extraction rules",
    description:
      "Edit the targets.yaml file to tell your agent which URLs to scrape and what data to extract from each page. Each target has a URL pattern and a list of fields to pull. You can use CSS selectors or describe what you want in plain English — the agent figures out the rest.",
    code: `# my-research-agent/targets.yaml
targets:
  - name: tech-news
    urls:
      - https://news.ycombinator.com
      - https://lobste.rs
    extract:
      - field: title
        selector: ".titleline a"
      - field: score
        description: "the point count for each story"
    schedule: every 6h`,
    label: "targets.yaml",
  },
  {
    number: 6,
    title: "Set rate limits and honor robots.txt",
    description:
      "Responsible web scraping agents respect the sites they visit. Open agent.yaml and add a politeness block to configure rate limiting. This tells the agent to wait between requests, honor robots.txt rules, and identify itself with a proper user-agent string.",
    code: `# Add to my-research-agent/agent.yaml
politeness:
  delay_ms: 2000
  respect_robots_txt: true
  max_concurrent: 2
  user_agent: "OpenClawBot/1.0 (+https://openclaw.ai/bot)"`,
    label: "Politeness config in agent.yaml",
    tip: "Always check a site's robots.txt and terms of service before scraping. Be a good citizen.",
  },
  {
    number: 7,
    title: "Test your scraping agent with a dry run",
    description:
      "Before running your agent in production, do a dry run to verify everything works. This fetches one page from each target, extracts the data, and prints the results to your terminal without saving anything.",
    code: "openclaw agent run my-research-agent --dry-run --verbose",
    label: "Dry run the agent",
    output:
      '[dry-run] Fetching https://news.ycombinator.com\n[dry-run] Extracted 30 items\n[dry-run] Sample:\n  { "title": "Show HN: ...", "score": "142 points" }\n[dry-run] Complete — no data written',
  },
  {
    number: 8,
    title: "Run the web scraping agent",
    description:
      "Once you're happy with the dry run output, launch your web scraping agent. It will crawl your target URLs, extract the data, and write structured JSON results to the output directory.",
    code: "openclaw agent run my-research-agent",
    label: "Run the agent",
    output:
      "Agent my-research-agent started\nProcessing target: tech-news (2 URLs)\n✓ 60 items extracted\nResults written to ./my-research-agent/output/2026-03-14.json",
  },
  {
    number: 9,
    title: "Schedule automated recurring scrapes",
    description:
      "If your targets.yaml includes a schedule field, register the agent with the OpenClaw daemon to run scrapes automatically on a recurring basis. The daemon handles retries, deduplication, and log rotation.",
    code: "openclaw agent schedule my-research-agent",
    label: "Register the agent with the daemon",
    output:
      "Scheduled: my-research-agent\n  tech-news: every 6h (next run: 18:00 UTC)",
    tip: "View all scheduled agents with: openclaw agent list --scheduled",
  },
  {
    number: 10,
    title: "View scraped data in the OpenClaw dashboard",
    description:
      "Open the OpenClaw dashboard in your browser to view your agent's scraped data, run history, and any errors. The research template includes a built-in data viewer that lets you filter and search through all extracted results.",
    link: "http://127.0.0.1:18789/agents/my-research-agent",
    linkLabel: "Open agent dashboard",
  },
];

const troubleshooting = [
  {
    problem: "Web scraping agent returns empty results",
    solution:
      "openclaw agent run my-research-agent --target tech-news --verbose --debug\n# Check if selectors match. JavaScript-rendered pages may need: tools: [fetch_page_js]",
  },
  {
    problem: "\"Error: rate limited\" or HTTP 429 responses",
    solution:
      "Increase delay_ms in your politeness config, or reduce max_concurrent to 1.",
  },
  {
    problem: "Scheduled scraping agent not running on time",
    solution:
      "openclaw daemon status\n# If the daemon is stopped, restart it with: openclaw daemon start",
  },
];

export default function WebScrapingAgentsGuidePage() {
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
          How to Build a Web Scraping Agent with OpenClaw
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Create an OpenClaw agent that crawls websites, extracts structured
          data, and schedules automated scrapes &mdash; all from your terminal.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: OpenClaw
          installed, API key configured
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
