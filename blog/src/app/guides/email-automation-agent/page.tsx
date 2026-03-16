import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Automate Email with OpenClaw — The Agent Post",
  description:
    "Learn how to automate email with OpenClaw in 10 minutes. Connect your inbox, set up triage rules, and let an AI agent sort, label, and draft replies for you.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Verify your OpenClaw installation is running",
    description:
      "Before building the email agent, confirm that OpenClaw is installed and the gateway is running. Check the system status to make sure every service shows a green checkmark.",
    code: "openclaw status",
    label: "Check OpenClaw status",
    output:
      "Gateway:   running (port 18789)\nDaemon:    running\nAgents:    0 active\nHealth:    all checks passed",
    tip: "If the gateway isn't running, start it with: openclaw gateway",
  },
  {
    number: 2,
    title: "Scaffold a new email agent project",
    description:
      "OpenClaw ships with agent templates for common automation tasks. Use the scaffold command to generate a new email agent project. This creates a folder with a config file, a rules directory, and a test harness.",
    code: "openclaw scaffold email-agent --name inbox-assistant",
    label: "Scaffold a new email agent",
    output:
      "Created ./inbox-assistant\n  config.yaml\n  rules/\n  tests/\n  README.md",
  },
  {
    number: 3,
    title: "Add your Gmail or Outlook credentials",
    description:
      "Navigate into the project directory and store your email provider credentials. OpenClaw supports Gmail, Outlook, and any IMAP-compatible provider. The built-in secrets store keeps your passwords encrypted at rest.",
    code: 'cd inbox-assistant\nopenclaw secrets set EMAIL_HOST "imap.gmail.com"\nopenclaw secrets set EMAIL_USER "you@gmail.com"\nopenclaw secrets set EMAIL_APP_PASSWORD "xxxx-xxxx-xxxx-xxxx"',
    label: "Store email credentials",
    tip: "For Gmail, use an App Password instead of your main password. Generate one at myaccount.google.com > Security > App Passwords.",
  },
  {
    number: 4,
    title: "Configure the IMAP mailbox connection",
    description:
      "Open config.yaml and set the IMAP provider, polling interval, and which mailbox folders to watch. The poll_interval controls how often the agent checks for new messages. Start with 60 seconds to avoid rate limits while testing.",
    code: `# config.yaml
provider: imap
connection:
  host: "{{EMAIL_HOST}}"
  user: "{{EMAIL_USER}}"
  password: "{{EMAIL_APP_PASSWORD}}"
  port: 993
  tls: true
watch_folders:
  - INBOX
poll_interval: 60`,
    label: "config.yaml",
  },
  {
    number: 5,
    title: "Write your first email triage rule",
    description:
      "Triage rules tell the agent how to classify and handle incoming email. Create a rule file that automatically labels newsletters and moves them out of your inbox. Each rule has a match condition, an action, and an optional priority.",
    code: `# rules/sort-newsletters.yaml
name: sort-newsletters
match:
  headers:
    list-unsubscribe: exists
action:
  label: "Newsletters"
  move_to: "Newsletters"
  mark_read: true
priority: 10`,
    label: "rules/sort-newsletters.yaml",
  },
  {
    number: 6,
    title: "Add an AI-powered auto-reply rule",
    description:
      "Now create a rule that drafts an automatic reply when someone emails you with an urgent subject line. The agent uses your configured LLM to generate context-aware responses. Setting draft_only to true means it will never send without your approval.",
    code: `# rules/urgent-reply.yaml
name: urgent-auto-reply
match:
  subject:
    contains: ["urgent", "asap", "time-sensitive"]
  from:
    not_contains: ["noreply", "no-reply"]
action:
  auto_reply:
    prompt: "Write a brief, professional reply acknowledging the urgency and confirming I'll respond in detail within 2 hours."
    draft_only: true
    tone: professional
priority: 1`,
    label: "rules/urgent-reply.yaml",
    tip: "Always start with draft_only: true. Review the agent's drafts for a week before enabling auto-send.",
  },
  {
    number: 7,
    title: "Test email rules locally before deploying",
    description:
      "Before connecting to your real inbox, run the test suite against sample emails. The test command loads fixture emails from the tests/ folder and shows you exactly what the agent would do with each one.",
    code: "openclaw test --verbose",
    label: "Run the agent test suite",
    output:
      "Loading 4 fixture emails...\n\n  newsletter@updates.example.com\n    -> sort-newsletters: MOVE to Newsletters, mark read  ✓\n\n  boss@company.com (Subject: Urgent Q3 review)\n    -> urgent-auto-reply: DRAFT reply  ✓\n\n  friend@gmail.com (Subject: Lunch tomorrow?)\n    -> no matching rule (pass through)  ✓\n\nAll 3 rules passed against 4 fixtures.",
  },
  {
    number: 8,
    title: "Deploy the email automation agent",
    description:
      "Register the agent with the OpenClaw daemon so it runs continuously in the background. The deploy command validates your config, tests the IMAP connection, and starts the polling loop.",
    code: "openclaw deploy",
    label: "Deploy the email agent",
    output:
      "Validating config...       ok\nTesting IMAP connection...  ok\nRegistering agent...        ok\n\nAgent \"inbox-assistant\" is live.\nDashboard: http://127.0.0.1:18789/agents/inbox-assistant",
  },
  {
    number: 9,
    title: "Monitor from the dashboard",
    description:
      "Open the agent's dashboard page in your browser to see processed messages, triggered rules, and any draft replies waiting for your approval. The activity log updates in real time.",
    link: "http://127.0.0.1:18789/agents/inbox-assistant",
    linkLabel: "Open agent dashboard",
  },
  {
    number: 10,
    title: "Review and send draft replies",
    description:
      "Any auto-reply drafts will appear in the Pending Drafts tab. You can edit them, approve them for sending, or discard them. Once you're confident in the agent's output, you can flip draft_only to false in the rule file and redeploy.",
    code: "openclaw drafts list\nopenclaw drafts approve --id <draft-id>",
    label: "Manage pending drafts",
    tip: "Use openclaw drafts approve --all to bulk-approve after reviewing in the dashboard.",
  },
];

const troubleshooting = [
  {
    problem: "IMAP connection fails with \"authentication error\"",
    solution:
      "For Gmail, make sure you're using an App Password, not your regular password. For Outlook, enable IMAP access in Settings > Mail > Sync email.",
  },
  {
    problem: "Rules aren't matching any emails",
    solution:
      "openclaw test --verbose --fixture tests/your-email.eml\n\nCheck that your match conditions use the correct header names. Run with --verbose to see why each rule was skipped.",
  },
  {
    problem: "Agent stops polling after a few hours",
    solution:
      "openclaw logs inbox-assistant --tail 50\n\nLook for rate-limit or timeout errors. Increase poll_interval to 120 seconds and redeploy.",
  },
];

export default function EmailAutomationAgentGuidePage() {
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
          Building an Email Automation Agent
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Connect OpenClaw to your inbox, define triage rules, and let an agent
          sort, label, and draft replies to your email automatically.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: OpenClaw
          installed, an email account with IMAP access
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
