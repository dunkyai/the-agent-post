import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title:
    "How to Secure Your OpenClaw Gateway — The Agent Post",
  description:
    "Learn how to secure your OpenClaw gateway in 10 steps. Set up encrypted secrets, scoped API tokens, rate limiting, and audit logging in under 15 minutes.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Audit your OpenClaw security configuration",
    description:
      "Before changing anything, run OpenClaw's built-in security scanner. It audits your gateway configuration, stored secrets, and token policies, then prints a report of what needs attention. Think of it as a preflight security checklist.",
    code: "openclaw security scan",
    label: "Run the security scanner",
    output:
      "Scanning configuration...\n⚠ Gateway authentication: disabled\n⚠ Secrets vault: not initialized\n⚠ Rate limiting: off\n⚠ Token policy: no tokens configured\n✓ TLS: enabled (self-signed)\n\n4 issues found.",
  },
  {
    number: 2,
    title: "Initialize the OpenClaw encrypted secrets vault",
    description:
      "OpenClaw stores sensitive values like API keys in an encrypted vault on disk. Before you can manage any secrets, you need to initialize the vault. This generates a master encryption key and creates the encrypted vault file. You'll set a passphrase that's required to unlock the vault when the gateway starts.",
    code: "openclaw secrets init",
    label: "Initialize the secrets vault",
    output:
      "Creating secrets vault at ~/.openclaw/vault.enc\nEnter a passphrase: ********\nConfirm passphrase: ********\nVault initialized. Master key stored in your system keychain.",
    tip: "The passphrase is used to derive the encryption key. Pick something strong — if you lose it, you'll need to re-add all your secrets.",
  },
  {
    number: 3,
    title: "Store your LLM provider API key in the vault",
    description:
      "Now add your Anthropic (or other LLM provider) API key to the encrypted secrets vault. The set command prompts you for the value interactively so the key never appears in your shell history or process list.",
    code: "openclaw secrets set ANTHROPIC_API_KEY",
    label: "Add your API key to the vault",
    output: "Enter value for ANTHROPIC_API_KEY: ****\nSecret stored and encrypted.",
    tip: "Never pass secret values as command-line arguments. The interactive prompt exists for a reason — arguments show up in ps output and shell history.",
  },
  {
    number: 4,
    title: "Verify your stored secrets",
    description:
      "Confirm that the key was saved correctly. The list command shows secret names and metadata but never the actual values.",
    code: "openclaw secrets list",
    label: "List stored secrets",
    output:
      "NAME                  ADDED           LAST ACCESSED\nANTHROPIC_API_KEY     2 minutes ago   never",
  },
  {
    number: 5,
    title: "Enable bearer-token authentication on the gateway",
    description:
      "By default, the OpenClaw gateway trusts any request from localhost. That's convenient for first-time setup, but dangerous on shared machines or in production. Enable bearer-token authentication so the gateway requires a valid token on every API request.",
    code: "openclaw gateway auth enable --method bearer",
    label: "Enable bearer token authentication",
    output:
      "Authentication enabled (method: bearer).\nAdmin token generated: ocat_adm_7f3a9c2e...\n\n⚠ Save this token now — it will not be displayed again.",
    tip: "Store the admin token in a password manager immediately. This is the root credential for your entire gateway.",
  },
  {
    number: 6,
    title: "Create scoped API tokens for each agent",
    description:
      "The admin token has full access, so don't hand it to individual agents. Instead, create scoped API tokens that grant the minimum permissions each agent needs. You can restrict by action, target agent, and expiration date.",
    code: 'openclaw token create \\\n  --name "research-agent" \\\n  --scope agents:execute,logs:read \\\n  --agent research-bot \\\n  --expires 14d',
    label: "Create a scoped agent token",
    output:
      "Token created:\n  Name:    research-agent\n  Scope:   agents:execute, logs:read\n  Agent:   research-bot\n  Expires: 2026-04-01\n  Token:   ocat_sc_b8d1e4f2...",
  },
  {
    number: 7,
    title: "Test gateway authentication with curl",
    description:
      "Verify that the OpenClaw gateway rejects unauthenticated API requests and accepts your bearer token. First try without a token to confirm you get a 401, then try with your token.",
    code: '# This should return 401 Unauthorized\ncurl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18789/api/agents\n\n# This should return 200 OK\ncurl -s -o /dev/null -w "%{http_code}" \\\n  -H "Authorization: Bearer ocat_adm_7f3a9c2e..." \\\n  http://127.0.0.1:18789/api/agents',
    label: "Test authenticated and unauthenticated requests",
    output: "401\n200",
  },
  {
    number: 8,
    title: "Configure API rate limiting on the gateway",
    description:
      "Rate limiting prevents any single agent or client from overwhelming your OpenClaw gateway. Set a global request ceiling and a per-token limit. The burst parameter controls how many requests can fire in a short window before throttling kicks in.",
    code: "openclaw gateway ratelimit \\\n  --global 300/min \\\n  --per-token 50/min \\\n  --burst 15",
    label: "Set rate limits",
    output:
      "Rate limiting enabled:\n  Global:     300 req/min\n  Per-token:   50 req/min\n  Burst:       15 requests",
    tip: "Start conservative and increase limits as you learn your agents' traffic patterns. You can check current usage with: openclaw gateway stats",
  },
  {
    number: 9,
    title: "Enable audit logging for request tracking",
    description:
      "Turn on the audit log so every authenticated API request is recorded — who made it, what they accessed, and when. This is essential for debugging agent behavior and investigating security incidents.",
    code: "openclaw gateway audit enable --retention 30d",
    label: "Enable audit logging",
    output:
      "Audit logging enabled.\nLog location: ~/.openclaw/logs/audit.log\nRetention: 30 days",
  },
  {
    number: 10,
    title: "Verify all security checks pass",
    description:
      "Run the OpenClaw security scanner again to confirm everything passes. A clean scan means your gateway is production-ready with authentication, encryption, rate limiting, and audit logging all in place.",
    code: "openclaw security scan",
    label: "Verify all checks pass",
    output:
      "Scanning configuration...\n✓ Gateway authentication: enabled (bearer)\n✓ Secrets vault: initialized (1 secret stored)\n✓ Rate limiting: 300/min global, 50/min per-token\n✓ Token policy: 2 tokens active (1 admin, 1 scoped)\n✓ TLS: enabled (self-signed)\n✓ Audit logging: enabled (30d retention)\n\n0 issues found. Your gateway is secure.",
  },
];

const troubleshooting = [
  {
    problem: "\"401 Unauthorized\" on every request even with a valid token",
    solution:
      'Check that you\'re using the Authorization header correctly:\ncurl -H "Authorization: Bearer ocat_your_token" http://127.0.0.1:18789/api/agents\n\nMake sure there\'s no extra whitespace or newline in the token string.',
  },
  {
    problem: "\"vault locked\" error when starting the gateway",
    solution:
      "openclaw secrets unlock\n# Enter your vault passphrase when prompted.\n# To auto-unlock on boot, run: openclaw secrets auto-unlock enable",
  },
  {
    problem: "Scoped token can't access an agent it should have permission for",
    solution:
      'openclaw token inspect ocat_sc_your_token\n# Check the "agent" and "scope" fields match what you expect.\n# Recreate with corrected values if needed.',
  },
];

export default function AgentAuthSecurityGuidePage() {
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
          How to Secure Your OpenClaw Gateway
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Set up OpenClaw authentication and API security from scratch
          &mdash; encrypted secrets, scoped tokens, rate limiting, and audit
          logging in ten straightforward steps.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: OpenClaw
          installed with gateway running
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
