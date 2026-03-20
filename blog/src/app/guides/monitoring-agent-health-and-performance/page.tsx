import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Monitor OpenClaw Agents — The Agent Post",
  description:
    "Learn how to monitor your OpenClaw agents with dashboards, health checks, alerts, and log streaming. Follow this 10-minute step-by-step setup guide.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Check that your OpenClaw agents are running",
    description:
      "Before setting up monitoring, confirm that your OpenClaw installation is healthy and your agents are online. The openclaw status command gives you a quick snapshot of every registered agent, its uptime, and the gateway connection.",
    code: "openclaw status",
    label: "Check agent status",
    output:
      "Gateway:   running (port 18789)\nAgents:    3 registered, 3 online\n\n  research-agent    online   uptime 4h 12m\n  email-agent       online   uptime 4h 12m\n  slack-bot         online   uptime 2h 07m",
  },
  {
    number: 2,
    title: "Enable the built-in metrics endpoint",
    description:
      "OpenClaw ships with a built-in metrics server for tracking agent performance, but it's off by default. Enable it by updating your config. This exposes a local HTTP endpoint that reports agent health data, error rates, and latency in real time.",
    code: "openclaw config set metrics.enabled true\nopenclaw config set metrics.port 18790",
    label: "Enable metrics",
    output: "Config updated. Restart the gateway to apply changes.",
    tip: "The metrics port (18790) is separate from the gateway port (18789). Make sure both are free.",
  },
  {
    number: 3,
    title: "Restart the OpenClaw gateway",
    description:
      "Config changes require a gateway restart. The restart command gracefully drains in-flight requests before cycling the process, so your agents won't drop any work.",
    code: "openclaw gateway restart",
    label: "Restart the gateway",
    output: "Draining connections... done\nGateway restarted\nMetrics endpoint: http://127.0.0.1:18790/metrics",
  },
  {
    number: 4,
    title: "Verify the metrics endpoint",
    description:
      "Hit the metrics endpoint with curl to confirm it's serving data. You'll see a JSON payload with uptime, request counts, error rates, and token usage for each agent.",
    code: "curl -s http://127.0.0.1:18790/metrics | jq .",
    label: "Fetch metrics",
    output:
      '{\n  "gateway_uptime_seconds": 14,\n  "agents": [\n    {\n      "name": "research-agent",\n      "status": "online",\n      "requests_total": 847,\n      "errors_total": 3,\n      "avg_latency_ms": 1240,\n      "tokens_used_24h": 52100\n    }\n  ]\n}',
    tip: "Install jq (brew install jq) for pretty-printed JSON. It makes reading metrics output much easier.",
  },
  {
    number: 5,
    title: "Open the monitoring dashboard",
    description:
      "OpenClaw includes a browser-based dashboard for visualizing agent performance. Navigate to the gateway URL and click the Monitoring tab, or go directly to the monitoring path.",
    link: "http://127.0.0.1:18789/monitoring",
    linkLabel: "Open monitoring dashboard",
  },
  {
    number: 6,
    title: "Set up health checks",
    description:
      "Health checks ping each agent on a schedule and flag any that stop responding. Enable them with a check interval in seconds. OpenClaw will mark an agent as degraded after two consecutive failures and offline after five.",
    code: "openclaw config set healthcheck.enabled true\nopenclaw config set healthcheck.interval 30",
    label: "Configure health checks",
    tip: "An interval of 30 seconds is a good default. Going below 10 seconds can add unnecessary load if you're running many agents.",
  },
  {
    number: 7,
    title: "Configure alerts",
    description:
      "Get notified when something goes wrong. OpenClaw can send alerts via webhook whenever an agent goes offline, error rates spike, or token usage exceeds a threshold. Point it at a Slack incoming webhook, a Discord webhook, or any URL that accepts POST requests.",
    code: "openclaw alerts add \\\n  --name \"slack-ops\" \\\n  --url \"https://hooks.slack.com/services/T00/B00/xxxx\" \\\n  --on agent.offline \\\n  --on error.rate.high \\\n  --on tokens.threshold",
    label: "Add a webhook alert",
    output: "Alert \"slack-ops\" created with 3 triggers.",
  },
  {
    number: 8,
    title: "Set token usage thresholds",
    description:
      "Runaway agents can burn through API credits fast. Set a daily token ceiling per agent so you get an alert before costs spiral. The threshold is measured in tokens per 24-hour rolling window.",
    code: "openclaw config set alerts.tokens_threshold 100000",
    label: "Set daily token limit",
    tip: "Start with 100k tokens per day and adjust based on your agents' actual usage. You can check historical usage with: openclaw metrics history --period 7d",
  },
  {
    number: 9,
    title: "Stream logs in real time",
    description:
      "When debugging a specific agent, tail its logs live. The logs command streams structured output including timestamps, log levels, and request IDs so you can trace exactly what an agent is doing.",
    code: "openclaw logs --agent research-agent --follow",
    label: "Tail agent logs",
    output:
      "[2026-03-20 14:32:01] INFO  research-agent  req_8a3f  Received task: summarize article\n[2026-03-20 14:32:02] INFO  research-agent  req_8a3f  LLM call started (model: claude-sonnet-4-6)\n[2026-03-20 14:32:04] INFO  research-agent  req_8a3f  LLM call complete (1,847 tokens, 1.8s)\n[2026-03-20 14:32:04] INFO  research-agent  req_8a3f  Task complete (total: 3.1s)",
  },
  {
    number: 10,
    title: "Run the diagnostic report",
    description:
      "The doctor command performs a full system check — gateway connectivity, agent responsiveness, config validation, port conflicts, and disk usage. Run it whenever things feel off or as part of a regular maintenance routine.",
    code: "openclaw doctor",
    label: "Run diagnostics",
    output:
      "Running 8 checks...\n\n  ✔ Gateway reachable on port 18789\n  ✔ Metrics endpoint responding on port 18790\n  ✔ 3/3 agents responding to health checks\n  ✔ Config file valid\n  ✔ Daemon process running (PID 48291)\n  ✔ Disk usage OK (logs: 24 MB)\n  ✔ No port conflicts detected\n  ✔ Alert webhooks reachable\n\nAll checks passed.",
  },
];

const troubleshooting = [
  {
    problem: "Metrics endpoint returns \"connection refused\"",
    solution:
      "openclaw config get metrics.enabled\n# If false, enable it and restart:\nopenclaw config set metrics.enabled true\nopenclaw gateway restart",
  },
  {
    problem: "Agent shows as \"degraded\" but seems to be working",
    solution:
      "openclaw logs --agent <agent-name> --level warn\n# Often caused by slow LLM responses. Increase the health check timeout:\nopenclaw config set healthcheck.timeout 15",
  },
  {
    problem: "Alert webhooks not firing",
    solution:
      "openclaw alerts test --name \"slack-ops\"\n# Sends a test payload to verify the URL is correct and reachable.",
  },
];

export default function MonitoringGuidePage() {
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
          How to Monitor OpenClaw Agent Health and Performance
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Learn how to set up metrics, dashboards, health checks, alerts, and
          real-time log streaming to keep your OpenClaw AI agents running
          reliably in production.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: OpenClaw
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
