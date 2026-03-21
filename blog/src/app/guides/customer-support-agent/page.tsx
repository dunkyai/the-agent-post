import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Build an AI Customer Support Agent — The Agent Post",
  description:
    "Learn how to build an AI customer support agent with OpenClaw. Set up intents, connect a knowledge base, and deploy automated ticket handling in minutes.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Create a new OpenClaw support project",
    description:
      "Start by scaffolding your AI customer support agent. The init command creates a project directory with a default agent config, a knowledge folder, and a manifest file.",
    code: "openclaw init customer-support --template support",
    label: "Scaffold a support project",
    output:
      "Created project: customer-support\n├── manifest.yaml\n├── agents/\n│   └── support-agent.yaml\n└── knowledge/",
  },
  {
    number: 2,
    title: "Navigate into your project directory",
    description:
      "Change into the new project directory. All subsequent OpenClaw commands should be run from here.",
    code: "cd customer-support",
    label: "Enter project directory",
  },
  {
    number: 3,
    title: "Define customer support intents",
    description:
      "Intents classify incoming customer requests into categories like billing questions, password resets, or order tracking. Each intent gets a name, a short description, and example phrases the agent uses for matching. Good intent coverage is the foundation of accurate ticket routing.",
    code: `openclaw intents add billing "Questions about charges, invoices, and payment methods" \\
  --examples "Why was I charged twice?" "Where is my invoice?"
openclaw intents add password-reset "Help users reset or recover their password" \\
  --examples "I forgot my password" "How do I change my login?"
openclaw intents add order-status "Track and update order delivery status" \\
  --examples "Where is my package?" "When will my order arrive?"`,
    label: "Add support intents",
    tip: "You can add more intents later. Start with 3\u20135 that cover your most common tickets.",
  },
  {
    number: 4,
    title: "Connect a knowledge base for automated answers",
    description:
      "The knowledge base is what your AI agent references when generating answers. Drop your FAQ documents, help articles, or policy files into the knowledge folder and index them. OpenClaw accepts Markdown, plain text, and PDF files.",
    code: `cp ~/docs/faq.md ./knowledge/
cp ~/docs/return-policy.md ./knowledge/
cp ~/docs/billing-guide.md ./knowledge/

openclaw knowledge index`,
    label: "Index your knowledge base",
    output:
      "Indexed 3 documents (47 sections, 12,840 tokens)\nKnowledge base ready.",
  },
  {
    number: 5,
    title: "Configure your AI agent's tone and guardrails",
    description:
      "Set the personality, tone, and response guardrails for your support agent. The persona command lets you define how the agent introduces itself, what language style it uses, and what it should never do — like promise refunds without checking policy first.",
    code: `openclaw persona set \\
  --name "Support Bot" \\
  --tone "friendly, professional, concise" \\
  --rules "Never promise a refund without checking return-policy.md" \\
  --rules "Always ask for an order number before looking up order status" \\
  --escalation "Transfer to a human agent if the customer asks three times"`,
    label: "Set agent personality and rules",
  },
  {
    number: 6,
    title: "Connect your support inbox via IMAP",
    description:
      "Tell your agent where customer tickets come from. OpenClaw supports email inboxes, web chat widgets, and API webhooks out of the box. Here we'll connect a shared support email inbox using IMAP for automated ticket ingestion.",
    code: `openclaw connect email \\
  --imap-host imap.yourcompany.com \\
  --imap-user support@yourcompany.com \\
  --password-env SUPPORT_EMAIL_PASSWORD \\
  --poll-interval 60`,
    label: "Connect an email inbox",
    tip: "Store credentials in environment variables instead of passing them directly. OpenClaw reads from .env files automatically.",
  },
  {
    number: 7,
    title: "Set up human escalation rules",
    description:
      "Not every ticket should be handled by AI. Escalation rules define when a conversation gets handed off to a human agent. You can trigger a handoff based on negative sentiment analysis, unrecognized topics, or the number of back-and-forth messages.",
    code: `openclaw escalation add \\
  --trigger sentiment-negative \\
  --threshold 0.8 \\
  --action notify --channel "#support-escalations"

openclaw escalation add \\
  --trigger intent-unknown \\
  --action transfer --to human-queue`,
    label: "Configure escalation rules",
  },
  {
    number: 8,
    title: "Test your support agent locally",
    description:
      "Before going live, run the AI support agent in test mode. This opens an interactive chat in your terminal where you can send sample customer questions and see how the agent responds. Nothing is sent to real customers.",
    code: "openclaw test --interactive",
    label: "Run in test mode",
    output:
      'Agent "Support Bot" loaded (3 intents, 47 knowledge sections)\nType a message to test. Press Ctrl+C to exit.\n\n> Where is my order?\nSupport Bot: I\'d be happy to help you track your order! Could you share your order number so I can look that up for you?',
  },
  {
    number: 9,
    title: "Run the agent in dry-run mode",
    description:
      "Dry-run mode connects to your real ticket source but doesn't send any replies. Instead, it logs what the agent would have said. This is a safe way to validate behavior on real data before going live.",
    code: "openclaw run --dry-run --log-file ./dry-run.log",
    label: "Dry-run against real tickets",
    output:
      "Dry-run mode: responses will be logged, not sent.\nPolling support@yourcompany.com every 60s...\n[ticket-4821] Intent: order-status | Confidence: 0.94 | Response logged",
    tip: "Review dry-run.log after a few hours and check for any misclassified intents before enabling live replies.",
  },
  {
    number: 10,
    title: "Deploy your agent",
    description:
      "When you're happy with the results, start the agent for real. The daemon flag keeps it running in the background, and the metrics flag exposes a local dashboard so you can monitor response times, intent accuracy, and escalation rates.",
    code: "openclaw run --daemon --metrics",
    label: "Deploy the support agent",
    output:
      'Agent "Support Bot" is live.\nDaemon PID: 48291\nMetrics dashboard: http://127.0.0.1:18789/metrics',
  },
];

const troubleshooting = [
  {
    problem: "\"No intents matched\" on most test messages",
    solution:
      "openclaw intents add <name> --examples \"...\" \"...\"\n# Add more example phrases to improve intent matching accuracy.",
  },
  {
    problem: "IMAP connection refused or times out",
    solution:
      'openclaw connect email --test\n# Verify credentials and check that your mail server allows IMAP access.\n# For Gmail, enable "Less secure apps" or use an App Password.',
  },
  {
    problem: "Agent gives wrong answers from the knowledge base",
    solution:
      "openclaw knowledge rebuild --verbose\n# Re-index after editing docs. Use --verbose to see which sections are matched.",
  },
];

export default function CustomerSupportAgentGuidePage() {
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
          Building a Customer Support Agent
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Set up an AI agent that triages tickets, answers common questions from
          your knowledge base, and escalates to humans when needed.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: OpenClaw
          installed, an LLM API key, and a support inbox
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
