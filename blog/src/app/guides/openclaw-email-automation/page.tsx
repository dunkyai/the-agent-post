import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Automate Gmail with OpenClaw — The Agent Post",
  description:
    "Learn how to automate your Gmail inbox with OpenClaw in 10 minutes. Set up triage rules to auto-label, archive, and draft replies — step-by-step tutorial.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Verify your OpenClaw installation",
    description:
      "Before you can automate Gmail, you need OpenClaw installed. Verify your installation by checking the version — you should see v0.9 or higher.",
    code: "openclaw --version",
    label: "Check OpenClaw version",
    tip: "If you don't have OpenClaw yet, follow our OpenClaw Setup Guide first.",
  },
  {
    number: 2,
    title: "Install the Gmail MCP server for OpenClaw",
    description:
      "OpenClaw connects to Gmail through an MCP server. Install the official Gmail MCP server to give your agent the ability to read, search, label, and draft emails in your inbox.",
    code: "openclaw mcp install @openclaw/gmail-mcp",
    label: "Install the Gmail MCP server",
    output: "✓ Installed @openclaw/gmail-mcp@1.4.2\n✓ Registered 6 tools: gmail_search, gmail_read, gmail_label, gmail_draft, gmail_send, gmail_archive",
  },
  {
    number: 3,
    title: "Authenticate OpenClaw with your Google account",
    description:
      "The Gmail MCP server needs OAuth permission to access your inbox. Run the auth command to open a browser window where you sign in to your Google account and grant access. Credentials are stored locally on your machine.",
    code: "openclaw mcp auth @openclaw/gmail-mcp",
    label: "Authenticate with Google",
    output: "Opening browser for Google OAuth...\n✓ Authenticated as you@gmail.com\n✓ Credentials saved to ~/.openclaw/mcp/gmail-mcp/credentials.json",
    tip: "Your credentials never leave your machine. OpenClaw connects directly to Gmail — there's no middleman server.",
  },
  {
    number: 4,
    title: "Create a new email automation agent project",
    description:
      "Scaffold a new OpenClaw agent project using the email template. This creates a folder with a pre-configured agent definition file and a rules directory where you'll define your inbox triage logic.",
    code: "openclaw agent create email-assistant --template email\ncd email-assistant",
    label: "Scaffold the agent project",
    output: "✓ Created agent project: email-assistant/\n  ├── agent.yaml\n  ├── rules/\n  │   └── example.yaml\n  └── tests/\n      └── inbox_mock.json",
  },
  {
    number: 5,
    title: "Configure the email agent in agent.yaml",
    description:
      "Open agent.yaml in your editor. This file defines your agent's name, which MCP servers it can use, and its system prompt. The template comes with sensible defaults — update the name and description to match your email workflow.",
    code: "openclaw agent edit",
    label: "Open agent config in your default editor",
    tip: "You can also edit agent.yaml directly with any text editor. The openclaw agent edit command just opens it for you.",
  },
  {
    number: 6,
    title: "Write your first email triage rule",
    description:
      "Triage rules tell your agent how to handle different types of email automatically. Create a rule that auto-labels newsletters and archives them. Rules are YAML files in the rules/ directory with a match condition and an action list.",
    code: `cat > rules/newsletters.yaml << 'EOF'
name: Archive newsletters
match:
  from_contains:
    - "newsletter@"
    - "digest@"
    - "noreply@substack.com"
  subject_not_contains:
    - "action required"
actions:
  - label: "Newsletters"
  - archive: true
EOF`,
    label: "Create a newsletter triage rule",
  },
  {
    number: 7,
    title: "Add a triage rule for urgent emails",
    description:
      "Create a second rule that flags high-priority messages and auto-drafts a short acknowledgment reply. The draft action creates a reply in your Gmail Drafts folder — the agent never sends anything without your approval.",
    code: `cat > rules/urgent.yaml << 'EOF'
name: Flag urgent messages
match:
  subject_contains:
    - "urgent"
    - "ASAP"
    - "time-sensitive"
  from_domain:
    - "yourcompany.com"
actions:
  - label: "Urgent"
  - star: true
  - draft_reply: "Thanks for flagging this. I'll take a look shortly."
EOF`,
    label: "Create an urgent email rule",
    tip: "The draft_reply action creates a draft — it does not send. You always review before anything goes out.",
  },
  {
    number: 8,
    title: "Validate your triage rules with lint",
    description:
      "Before running your email automation agent, validate that your triage rules are syntactically correct and don't conflict with each other. The lint command checks for common mistakes like overlapping match conditions.",
    code: "openclaw agent lint",
    label: "Validate agent rules",
    output: "✓ agent.yaml — valid\n✓ rules/newsletters.yaml — valid\n✓ rules/urgent.yaml — valid\n✓ No conflicting rules detected\n\n2 rules loaded, 0 warnings",
  },
  {
    number: 9,
    title: "Test your email agent with a dry run",
    description:
      "Run the agent in dry-run mode against your last 20 Gmail messages. It shows what actions it would take without actually modifying anything. This is the safest way to verify your triage rules behave as expected.",
    code: "openclaw agent run --dry-run --limit 20",
    label: "Dry run against recent emails",
    output: '3 of 20 emails matched rules:\n  ✓ "Weekly Tech Digest" → label:Newsletters, archive\n  ✓ "Your March Newsletter" → label:Newsletters, archive\n  ✓ "ASAP: Deploy approval needed" → label:Urgent, star, draft reply\n17 emails — no matching rules (skipped)',
  },
  {
    number: 10,
    title: "Run the OpenClaw email agent in live mode",
    description:
      "When you're happy with the dry run results, start the agent in live mode. It will process your Gmail inbox, apply the matching triage rules, and poll for new emails every 2 minutes. Press Ctrl+C to stop.",
    code: "openclaw agent run --poll 2m",
    label: "Start the agent in live mode",
    output: "Agent email-assistant started\nPolling inbox every 2m\nPress Ctrl+C to stop",
    tip: "Add --daemon to run the agent in the background: openclaw agent run --poll 2m --daemon",
  },
];

const troubleshooting = [
  {
    problem: "OpenClaw Google OAuth fails or times out",
    solution:
      "openclaw mcp auth @openclaw/gmail-mcp --reset\n# Then re-run the auth flow in a fresh browser window",
  },
  {
    problem: "OpenClaw shows \"No matching rules\" on emails that should match",
    solution:
      'openclaw agent test --email "sender@example.com" --subject "Weekly Newsletter"\n# This shows which rules were evaluated and why they didn\'t match',
  },
  {
    problem: "OpenClaw agent crashes with \"token expired\" Gmail error",
    solution:
      "openclaw mcp auth @openclaw/gmail-mcp --refresh\n# Refreshes your Google credentials without a full re-auth",
  },
];

export default function EmailAutomationGuidePage() {
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
          How to Automate Gmail with an OpenClaw Agent
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Build an AI email automation agent with OpenClaw and Gmail. Define
          triage rules to auto-label, archive, and draft replies — so your
          inbox runs itself.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: OpenClaw
          installed, a Gmail account
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
