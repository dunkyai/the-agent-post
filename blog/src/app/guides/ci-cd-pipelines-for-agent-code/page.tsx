import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Set Up CI/CD for OpenClaw Agents — The Agent Post",
  description:
    "Learn how to set up CI/CD pipelines for your OpenClaw agents with GitHub Actions. Automate validation, testing, and deployment in under 15 minutes.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Initialize a Git repository for your OpenClaw project",
    description:
      "If your OpenClaw agent project isn't already version-controlled, start by initializing a Git repository. Navigate to your project directory and run the following:",
    code: "cd ~/my-agents\ngit init\ngit add .\ngit commit -m \"Initial commit\"",
    label: "Initialize Git repo",
  },
  {
    number: 2,
    title: "Push your agent project to a GitHub repository",
    description:
      "Create a new repository on GitHub, then connect your local project and push your agent code. Replace the URL below with your own repository URL.",
    code: "git remote add origin https://github.com/yourname/my-agents.git\ngit branch -M main\ngit push -u origin main",
    label: "Push to GitHub",
    tip: "If you're using SSH keys with GitHub, use the git@github.com:yourname/my-agents.git format instead.",
  },
  {
    number: 3,
    title: "Create the GitHub Actions workflow directory",
    description:
      "GitHub Actions looks for workflow files in a specific directory. Create the folder structure it expects:",
    code: "mkdir -p .github/workflows",
    label: "Create workflows directory",
  },
  {
    number: 4,
    title: "Write a GitHub Actions CI workflow file",
    description:
      "Create a GitHub Actions workflow that runs on every push and pull request. This will validate your OpenClaw agent configuration files, run your test suite, and catch issues before code reaches production.",
    code: "# .github/workflows/ci.yml\nname: Agent CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: npm ci\n      - run: npx openclaw validate --strict\n      - run: npm test",
    label: ".github/workflows/ci.yml",
  },
  {
    number: 5,
    title: "Install OpenClaw and enable agent config validation",
    description:
      "The openclaw validate command checks your agent YAML files for syntax errors, missing fields, and invalid tool references. Install OpenClaw as a dev dependency so the GitHub Actions CI runner can validate your configs automatically.",
    code: "npm install --save-dev openclaw",
    label: "Install OpenClaw as a dev dependency",
    output: "added 1 package in 3s",
  },
  {
    number: 6,
    title: "Write automated tests for your OpenClaw agent",
    description:
      "Add a test file that verifies your agent loads correctly and responds to a simple prompt. Automated tests catch broken configs and missing environment variables before deployment. Create this file at tests/agent.test.js:",
    code: "// tests/agent.test.js\nimport { loadAgent } from \"openclaw/testing\";\n\ndescribe(\"support-agent\", () => {\n  it(\"loads without errors\", async () => {\n    const agent = await loadAgent(\"./agents/support-agent.yml\");\n    expect(agent.name).toBe(\"support-agent\");\n    expect(agent.tools.length).toBeGreaterThan(0);\n  });\n\n  it(\"responds to a greeting\", async () => {\n    const agent = await loadAgent(\"./agents/support-agent.yml\");\n    const res = await agent.dryRun(\"Hello\");\n    expect(res.status).toBe(\"ok\");\n  });\n});",
    label: "tests/agent.test.js",
    tip: "The dryRun method simulates agent execution without calling the LLM, so tests stay fast and free.",
  },
  {
    number: 7,
    title: "Store API keys securely with GitHub Actions secrets",
    description:
      "Your deployment workflow will need your OpenClaw API key. Never hardcode secrets in workflow files. Instead, go to your GitHub repo's Settings > Secrets and variables > Actions, click \"New repository secret\", and add your key with the name OPENCLAW_API_KEY.",
    link: "https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions",
    linkLabel: "GitHub Actions secrets docs",
    tip: "If your agents call an LLM, add that API key as a secret too (e.g. ANTHROPIC_API_KEY).",
  },
  {
    number: 8,
    title: "Create a GitHub Actions deployment workflow",
    description:
      "Create a second GitHub Actions workflow that automatically deploys your agents to your OpenClaw gateway whenever code is merged to main. This uses the openclaw deploy command, which pushes your agent configs and restarts the daemon.",
    code: "# .github/workflows/deploy.yml\nname: Deploy Agents\n\non:\n  push:\n    branches: [main]\n\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: npm ci\n      - run: npx openclaw deploy --gateway ${{ secrets.GATEWAY_URL }}\n        env:\n          OPENCLAW_API_KEY: ${{ secrets.OPENCLAW_API_KEY }}",
    label: ".github/workflows/deploy.yml",
  },
  {
    number: 9,
    title: "Run CI/CD validation and tests locally",
    description:
      "Run the same validation and test commands locally to make sure everything passes before you push to GitHub. This saves you from waiting on a failing CI pipeline run.",
    code: "npx openclaw validate --strict && npm test",
    label: "Run validation and tests locally",
    output: "✔ agents/support-agent.yml — valid\n✔ agents/triage-agent.yml — valid\n\nTest Suites: 1 passed, 1 total\nTests:       2 passed, 2 total",
  },
  {
    number: 10,
    title: "Push and watch the pipeline run",
    description:
      "Commit your workflow files and push to GitHub. Then head to the Actions tab in your repository to see the pipeline execute in real time.",
    code: "git add .github/ tests/ package.json\ngit commit -m \"Add CI/CD pipeline\"\ngit push origin main",
    label: "Push workflow files",
    link: "https://github.com/yourname/my-agents/actions",
    linkLabel: "View your Actions tab on GitHub",
  },
];

const troubleshooting = [
  {
    problem: "\"openclaw: command not found\" in CI",
    solution:
      "Make sure openclaw is in your package.json devDependencies and you run npx openclaw instead of openclaw directly.",
  },
  {
    problem: "Deploy step fails with \"unauthorized\"",
    solution:
      "Verify that OPENCLAW_API_KEY is set in your GitHub repo secrets (Settings > Secrets > Actions) and the key hasn't expired.",
  },
  {
    problem: "Tests pass locally but fail in CI",
    solution:
      "Check that all environment variables your agents need are available in the CI environment. Add them as GitHub secrets and reference them with ${{ secrets.VAR_NAME }}.",
  },
];

export default function CiCdPipelinesGuidePage() {
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
          CI/CD Pipelines for Agent Code
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Automate testing and deployment for your OpenClaw agents using GitHub
          Actions so every merge is validated and shipped.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: GitHub account,
          Node.js 22+, OpenClaw project
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
