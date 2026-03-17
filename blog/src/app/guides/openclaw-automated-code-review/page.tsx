import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Automate Code Review with OpenClaw — The Agent Post",
  description:
    "Learn how to automate code review with OpenClaw. Connect to GitHub, configure review rules, and get AI-powered feedback on every pull request in minutes.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Verify your OpenClaw installation",
    description:
      "Before setting up automated code review, make sure OpenClaw is installed and running. Check your version — you need v0.9 or higher for the code review plugin.",
    code: "openclaw --version",
    label: "Check OpenClaw version",
    tip: "If you don't have OpenClaw yet, follow our Setup Guide first.",
  },
  {
    number: 2,
    title: "Install the OpenClaw code review plugin",
    description:
      "OpenClaw uses plugins to extend agent capabilities. The code review plugin gives your agent the tools it needs to read pull request diffs, post inline comments, and approve or request changes automatically.",
    code: "openclaw plugin install @openclaw/code-review",
    label: "Install the code-review plugin",
    output: "✓ @openclaw/code-review@1.4.2 installed\n✓ Registered 3 new tools: diff_read, inline_comment, review_submit",
  },
  {
    number: 3,
    title: "Connect OpenClaw to your GitHub account",
    description:
      "The review agent needs access to your GitHub repositories. Run the auth command to start a browser-based OAuth flow. This grants OpenClaw read/write access to pull requests on repos you choose — it never touches your code directly.",
    code: "openclaw auth github",
    label: "Authenticate with GitHub",
    output: "Opening browser for GitHub authorization...\n✓ Authenticated as @your-username\n✓ Token stored in ~/.openclaw/credentials",
  },
  {
    number: 4,
    title: "Create an AI code review agent",
    description:
      "Agents in OpenClaw are defined by a name and a role. Create a new agent dedicated to automated code review. The role flag tells OpenClaw which default prompt template and toolset to load.",
    code: "openclaw agent create reviewer --role code-review",
    label: "Create the reviewer agent",
    output: "✓ Agent \"reviewer\" created\n  Role: code-review\n  Config: ~/.openclaw/agents/reviewer.yaml",
  },
  {
    number: 5,
    title: "Set the target GitHub repository",
    description:
      "Tell the review agent which GitHub repository to watch. Replace the owner and repo name with your own. You can add multiple repos later by running this command again with a different repo.",
    code: "openclaw agent config reviewer --repo your-org/your-repo",
    label: "Point the agent at your repo",
    tip: "For monorepos, you can scope reviews to specific paths with --paths \"src/,lib/\" to avoid noisy reviews on docs or config changes.",
  },
  {
    number: 6,
    title: "Configure review rules for security and performance",
    description:
      "Review rules tell the agent what to look for in your code. You can enable built-in rulesets to catch security vulnerabilities, performance issues, and common bugs. Rules are additive — enable as many as you want.",
    code: "openclaw agent config reviewer \\\n  --rules security,performance,bugs \\\n  --severity medium",
    label: "Set review focus areas and minimum severity",
    tip: "Start with fewer rules and a higher severity threshold. You can always tighten them later once you trust the agent's feedback.",
  },
  {
    number: 7,
    title: "Set up the GitHub webhook listener",
    description:
      "The watch command starts a long-running process that listens for new pull requests and push events via GitHub webhooks. OpenClaw handles webhook registration automatically — no manual GitHub settings required.",
    code: "openclaw agent watch reviewer",
    label: "Start watching for pull requests",
    output: "✓ Webhook registered for your-org/your-repo\n✓ Agent \"reviewer\" is now watching for pull_request and push events\n  Listening on gateway port 18789...",
  },
  {
    number: 8,
    title: "Test automated review on a pull request",
    description:
      "Open a pull request on your repo (or use an existing one) to trigger an automated review. You can also manually trigger a review on any open PR by passing its number.",
    code: "openclaw agent run reviewer --pr 42",
    label: "Manually trigger a review on PR #42",
    output: "Reviewing PR #42: \"Add user input validation\"\n  Reading diff... 3 files changed, +87 -12\n  Analyzing with rules: security, performance, bugs\n  Found 2 issues (1 medium, 1 low)\n✓ Review posted to PR #42",
  },
  {
    number: 9,
    title: "Customize the review prompt",
    description:
      "Every agent has an editable prompt file that controls its personality and instructions. Open it to add project-specific context — like your team's naming conventions, preferred patterns, or things to always flag.",
    code: "openclaw agent edit-prompt reviewer",
    label: "Open the agent's prompt in your editor",
    tip: "Good additions: \"We use camelCase for variables\", \"Flag any use of console.log in production code\", \"Prefer early returns over nested if-else\".",
  },
  {
    number: 10,
    title: "Run the agent as a background daemon",
    description:
      "Once you're happy with the reviews, run the agent as a daemon so it stays active in the background. It will start automatically when your machine boots and survive terminal closures.",
    code: "openclaw agent start reviewer --daemon",
    label: "Start the agent as a background service",
    output: "✓ Agent \"reviewer\" started as daemon (PID 48291)\n  Logs: ~/.openclaw/logs/reviewer.log\n  Stop with: openclaw agent stop reviewer",
  },
];

const troubleshooting = [
  {
    problem: "Agent posts reviews but they appear as a generic bot",
    solution:
      "openclaw auth github --refresh\n# Then re-register the webhook:\nopenclaw agent watch reviewer --reset-webhook",
  },
  {
    problem: "Reviews are too noisy or flag trivial issues",
    solution:
      'openclaw agent config reviewer --severity high\n# Or exclude specific rules:\nopenclaw agent config reviewer --exclude-rules "style,naming"',
  },
  {
    problem: "Webhook events are not being received",
    solution:
      "openclaw doctor --check webhooks\n# Make sure your gateway is running:\nopenclaw gateway",
  },
];

export default function AutomatedCodeReviewGuidePage() {
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
          Automated Code Review with OpenClaw
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Set up an OpenClaw agent that watches your GitHub repos and posts
          detailed code reviews on every pull request, automatically.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 8&ndash;12 minutes &middot; Requires: OpenClaw
          installed, GitHub account
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
