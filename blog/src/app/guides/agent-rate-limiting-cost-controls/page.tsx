import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "OpenClaw Rate Limiting & Cost Controls Guide — The Agent Post",
  description:
    "Learn how to set up rate limiting, spending caps, and budget alerts for OpenClaw agents in under 10 minutes. Control API costs with per-agent limits and daily caps.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Check your current OpenClaw agent usage",
    description:
      "Before setting any limits, review where your API spending stands. The usage command shows a breakdown of API calls, token consumption, and estimated costs across all your running OpenClaw agents.",
    code: "openclaw usage --summary",
    label: "View usage summary",
    output:
      "Agent            Requests (24h)   Tokens        Est. Cost\n─────────────────────────────────────────────────────────\nresearch-bot     1,204            3.1M          $4.82\ninbox-triager    487              890K           $1.34\ncode-reviewer    62               210K           $0.31\n─────────────────────────────────────────────────────────\nTotal            1,753            4.2M          $6.47",
  },
  {
    number: 2,
    title: "Set a global monthly spending cap",
    description:
      "The spending cap is your safety net. Once your agents hit this dollar amount in a calendar month, OpenClaw pauses all non-critical agent activity and notifies you. Set it to whatever you're comfortable with.",
    code: "openclaw config set budget.monthly_cap 50.00",
    label: "Set a $50/month spending cap",
    tip: "Start conservative. You can always raise the cap later with the same command.",
  },
  {
    number: 3,
    title: "Set per-agent budget limits",
    description:
      "A global cap is good, but one runaway agent can eat the whole budget. Per-agent spending limits let you allocate API costs individually. If an agent hits its limit, only that agent pauses — the rest keep running.",
    code: "openclaw config set budget.agent.research-bot 20.00\nopenclaw config set budget.agent.inbox-triager 10.00\nopenclaw config set budget.agent.code-reviewer 5.00",
    label: "Set per-agent monthly limits",
  },
  {
    number: 4,
    title: "Configure API request rate limiting",
    description:
      "Rate limiting controls how many API requests an agent can make per minute. This prevents tight loops or recursive tool calls from burning through your token budget. The default is unlimited, so you'll want to set a requests-per-minute (RPM) limit.",
    code: "openclaw config set ratelimit.default_rpm 30",
    label: "Set default rate limit to 30 requests per minute",
    tip: "For agents that need burst capacity, override the default per-agent: openclaw config set ratelimit.agent.research-bot 60",
  },
  {
    number: 5,
    title: "Set a per-request token limit",
    description:
      "Large context windows mean a single API request can get expensive. The token limit caps the maximum input + output tokens for any individual call. Requests that would exceed this threshold are blocked and logged.",
    code: "openclaw config set ratelimit.max_tokens_per_request 16000",
    label: "Cap individual requests at 16K tokens",
    output: "Config updated: ratelimit.max_tokens_per_request = 16000",
  },
  {
    number: 6,
    title: "Enable budget alerts and notifications",
    description:
      "Budget alerts warn you before you hit your spending cap. Set threshold percentages where you want to be notified. OpenClaw sends cost notifications to your configured channel — terminal, email, or Slack webhook.",
    code: "openclaw config set alerts.thresholds 50,80,95\nopenclaw config set alerts.channel slack\nopenclaw config set alerts.slack_webhook https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
    label: "Alert at 50%, 80%, and 95% of budget",
  },
  {
    number: 7,
    title: "Set up daily spending limits",
    description:
      "Monthly caps don't catch a bad day early enough. A daily spending limit acts as a circuit breaker — if your agents exceed this amount in a single day, all activity pauses until midnight UTC.",
    code: "openclaw config set budget.daily_cap 5.00",
    label: "Set a $5/day spending limit",
    tip: "Daily caps are especially useful when you're testing new agent configurations and aren't sure how much they'll consume.",
  },
  {
    number: 8,
    title: "Review your rate limiting and budget configuration",
    description:
      "Verify everything looks right. The config show command displays all your rate limiting, spending caps, and alert settings in one view. Check that your limits make sense together — your daily cap times 30 should roughly align with your monthly budget.",
    code: "openclaw config show --section budget,ratelimit,alerts",
    label: "Review all cost control settings",
    output:
      "[budget]\nmonthly_cap       = 50.00\ndaily_cap         = 5.00\nagent.research-bot   = 20.00\nagent.inbox-triager  = 10.00\nagent.code-reviewer  = 5.00\n\n[ratelimit]\ndefault_rpm       = 30\nmax_tokens_per_request = 16000\n\n[alerts]\nthresholds        = 50,80,95\nchannel           = slack",
  },
  {
    number: 9,
    title: "Test your cost controls with a dry run",
    description:
      "Don't wait for a real budget overage to find out your config works. The simulate command runs a mock scenario where an agent tries to exceed its spending limit, so you can confirm that pausing and alerts trigger correctly.",
    code: "openclaw simulate --agent research-bot --scenario over-budget",
    label: "Simulate a budget overage",
    output:
      "Simulating: research-bot exceeds monthly limit...\n✔ Agent paused at $20.00\n✔ Alert sent to slack (threshold: 95%)\n✔ Other agents unaffected\nSimulation passed.",
  },
  {
    number: 10,
    title: "Monitor agent spending in the OpenClaw dashboard",
    description:
      "The OpenClaw dashboard gives you a real-time view of agent API costs. Open it in your browser to see spending graphs, rate limit hits, and alert history. You can also adjust budget limits directly from the UI.",
    link: "http://127.0.0.1:18789/costs",
    linkLabel: "Open cost dashboard",
  },
];

const troubleshooting = [
  {
    problem: "Agent keeps running after hitting its spending cap",
    solution:
      "openclaw restart gateway\n# In-flight requests complete before caps take effect.\n# A gateway restart forces an immediate re-check.",
  },
  {
    problem: "Slack alerts not arriving",
    solution:
      'openclaw test alerts --channel slack\n# Verifies your webhook URL is valid and reachable.\n# Check that the URL starts with "https://hooks.slack.com/".',
  },
  {
    problem: "Rate limit too low — agent requests timing out",
    solution:
      "openclaw config set ratelimit.agent.research-bot 60\n# Raise the per-agent RPM for agents that need burst capacity.",
  },
];

export default function SetupGuidePage() {
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
          OpenClaw Rate Limiting &amp; Cost Controls
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Set spending caps, configure request throttling, and enable budget
          alerts to keep your OpenClaw agent API costs under control.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 5&ndash;10 minutes &middot; Requires: OpenClaw
          installed with at least one running agent
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
