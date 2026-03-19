import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title:
    "Build a Web Scraping Agent with OpenClaw — The Agent Post",
  description:
    "Step-by-step guide to building an OpenClaw web scraping agent. Install the scraper plugin, define extraction rules, and automate data collection on a schedule.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Verify your OpenClaw installation and daemon",
    description:
      "Before building your web scraping agent, confirm that OpenClaw is installed and the gateway daemon is running. The scraper plugin requires version 0.9 or higher.",
    code: "openclaw --version && openclaw daemon status",
    label: "Verify OpenClaw and daemon",
    output:
      "openclaw 0.9.3\nDaemon: running (pid 41082)\nGateway: http://127.0.0.1:18789",
    tip: 'Don\'t have OpenClaw yet? Follow our OpenClaw Setup Guide first.',
  },
  {
    number: 2,
    title: "Install the OpenClaw scraper plugin",
    description:
      "The OpenClaw scraper plugin gives your agents the ability to fetch web pages, parse HTML, take screenshots, and extract structured data. It handles JavaScript-rendered pages out of the box using a bundled headless browser.",
    code: "openclaw plugin install @openclaw/scraper",
    label: "Install the scraper plugin",
    output:
      "Downloading @openclaw/scraper@1.4.2...\n\u2713 Installed @openclaw/scraper@1.4.2\n\u2713 Tools registered: fetch_page, fetch_page_js, extract_content, screenshot",
  },
  {
    number: 3,
    title: "Create a new research agent from a template",
    description:
      "Use the built-in research template to scaffold a new agent project. This template comes pre-configured with web fetching tools, a JSON output schema, and a targets file where you list the URLs you want to scrape.",
    code: "openclaw agent create market-researcher --template research",
    label: "Create a research agent",
    output:
      "Created agent: market-researcher\nDirectory: ./market-researcher\nTemplate: research\nFiles: agent.yaml, targets.yaml, results.schema.json",
  },
  {
    number: 4,
    title: "Define scraping targets and extraction rules",
    description:
      "Open targets.yaml and list the URLs you want your agent to scrape. Each target includes a name, one or more URLs, and data extraction rules. You can use CSS selectors for precise extraction, or describe what you want in plain English and let the LLM determine the selectors.",
    code: `# market-researcher/targets.yaml
targets:
  - name: competitor-pricing
    urls:
      - https://example.com/pricing
      - https://competitor.io/plans
    extract:
      - field: plan_name
        selector: ".plan-title"
      - field: price
        selector: ".plan-price"
      - field: features
        description: "list of included features for each plan"

  - name: industry-news
    urls:
      - https://news.ycombinator.com
      - https://techcrunch.com
    extract:
      - field: headline
        selector: "h2 a, .titleline a"
      - field: summary
        description: "first paragraph or subtitle of each article"`,
    label: "targets.yaml",
  },
  {
    number: 5,
    title: "Configure rate limits and robots.txt compliance",
    description:
      "Responsible web scraping agents respect the sites they visit. Add a politeness block to agent.yaml to configure a delay between requests, honor robots.txt directives, and limit concurrent connections. This helps avoid getting blocked and keeps your scraping ethical.",
    code: `# Add to market-researcher/agent.yaml
politeness:
  delay_ms: 2000
  respect_robots_txt: true
  max_concurrent: 2
  user_agent: "OpenClawBot/1.0 (+https://openclaw.ai/bot)"`,
    label: "Politeness settings in agent.yaml",
    tip: "Always review a site's robots.txt and terms of service before scraping. When in doubt, add a longer delay.",
  },
  {
    number: 6,
    title: "Test your scraping agent with a dry run",
    description:
      "Before running a full scrape, test your agent with a dry run. This fetches one page per target, extracts a sample of the data, and prints results to your terminal without writing output files. Use the --verbose flag to see exactly what the agent does at each step.",
    code: "openclaw agent run market-researcher --dry-run --verbose",
    label: "Dry run the agent",
    output:
      '[dry-run] Fetching https://example.com/pricing\n[dry-run] Extracted 3 items from competitor-pricing\n[dry-run] Sample:\n  { "plan_name": "Starter", "price": "$9/mo", "features": ["5 users", "10 GB"] }\n[dry-run] Fetching https://news.ycombinator.com\n[dry-run] Extracted 30 items from industry-news\n[dry-run] Complete \u2014 no data written',
  },
  {
    number: 7,
    title: "Run the web scraping agent",
    description:
      "Once the dry run output looks correct, run your web scraping agent for real. It will crawl all target URLs, extract data according to your rules, and write structured JSON results to the output directory.",
    code: "openclaw agent run market-researcher",
    label: "Run the agent",
    output:
      "Agent market-researcher started\nProcessing target: competitor-pricing (2 URLs)\n\u2713 6 items extracted\nProcessing target: industry-news (2 URLs)\n\u2713 58 items extracted\nResults written to ./market-researcher/output/2026-03-19.json",
  },
  {
    number: 8,
    title: "Add automated research synthesis",
    description:
      "OpenClaw agents go beyond basic web scraping \u2014 they can analyze and summarize what they collect. Add a synthesis block to agent.yaml to have the agent generate research reports from scraped data after each run. The output gets written to a separate report file.",
    code: `# Add to market-researcher/agent.yaml
synthesis:
  enabled: true
  prompt: |
    Analyze the scraped data and produce a brief research report.
    Compare competitor pricing tiers. Highlight any significant
    industry news that could affect our product strategy.
  output: reports/weekly-summary.md`,
    label: "Synthesis config in agent.yaml",
    tip: "Synthesis uses your configured LLM. Keep prompts focused to control token costs.",
  },
  {
    number: 9,
    title: "Schedule recurring scrapes with the daemon",
    description:
      "Register your agent with the OpenClaw daemon to automate web scraping on a recurring schedule. Add a schedule field to each target in targets.yaml, then register the agent. The daemon handles retries, deduplication, and log rotation automatically.",
    code: "openclaw agent schedule market-researcher",
    label: "Register the scheduled agent",
    output:
      "Scheduled: market-researcher\n  competitor-pricing: every 24h (next run: 00:00 UTC)\n  industry-news: every 6h (next run: 18:00 UTC)",
  },
  {
    number: 10,
    title: "Monitor scraping results in the OpenClaw dashboard",
    description:
      "Open your browser and navigate to the OpenClaw dashboard for your agent. You'll see a timeline of past runs, extracted data you can filter and search, generated research reports, and any errors from the scraping process.",
    link: "http://127.0.0.1:18789/agents/market-researcher",
    linkLabel: "Open agent dashboard",
  },
];

const troubleshooting = [
  {
    problem: "OpenClaw agent returns empty results for a scraping target",
    solution:
      'openclaw agent run market-researcher --target competitor-pricing --verbose --debug\n# If the page uses JavaScript rendering, switch to fetch_page_js in agent.yaml:\n# tools: [fetch_page_js, extract_content]',
  },
  {
    problem: "HTTP 429 (rate limited) or HTTP 403 (forbidden) errors",
    solution:
      "Increase delay_ms in your politeness config (try 5000) and reduce\nmax_concurrent to 1. Check the site's robots.txt for crawl-delay directives.",
  },
  {
    problem: "Scheduled scraping agent not running on time",
    solution:
      "openclaw daemon status\n# If the daemon is stopped, restart it:\nopenclaw daemon start\n# Check agent schedule with:\nopenclaw agent list --scheduled",
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
          Build a Web Scraping Agent with OpenClaw
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Follow this step-by-step tutorial to create an OpenClaw agent that
          scrapes websites, extracts structured data, generates automated
          research reports, and runs on a recurring schedule.
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
