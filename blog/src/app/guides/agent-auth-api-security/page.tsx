import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Secure Your OpenClaw Gateway — The Agent Post",
  description:
    "Learn how to secure your OpenClaw gateway with token authentication, API key encryption, rate limiting, and TLS. Follow this 10-step production security guide.",
};

const steps: {
  number: number;
  title: string;
  description: string;
  code: string;
  label: string;
  output?: string;
  tip?: string;
  link?: string;
  linkLabel?: string;
}[] = [
  {
    number: 1,
    title: "Audit your OpenClaw gateway security",
    description:
      "Before making changes, run an OpenClaw security audit to review your current gateway configuration. The audit scans for common vulnerabilities — open ports, missing authentication, unencrypted secrets, and disabled rate limiting.",
    code: "openclaw security audit",
    label: "Run a security audit",
    output:
      "Scanning gateway config...\n⚠ Gateway auth: disabled\n⚠ API keys: none configured\n⚠ Rate limiting: off\n✓ TLS: enabled (self-signed)\n\n3 issues found. Run 'openclaw security fix' for recommendations.",
  },
  {
    number: 2,
    title: "Enable token-based gateway authentication",
    description:
      "By default, the OpenClaw gateway accepts unauthenticated requests from localhost. In any shared or production environment, you need to enable token-based authentication. This command activates auth and generates your first admin bearer token.",
    code: "openclaw gateway auth enable",
    label: "Enable gateway auth",
    output:
      "Authentication enabled.\nAdmin token generated: ocat_a1b2c3d4e5f6...\nSave this token — it won't be shown again.",
    tip: "Copy the admin token immediately and store it in a password manager. You cannot retrieve it later.",
  },
  {
    number: 3,
    title: "Store API keys in the encrypted secrets vault",
    description:
      "OpenClaw includes an encrypted secrets vault so you never have to store API keys in plaintext config files. Use the secrets command to add your LLM provider key. It will be encrypted at rest and only decrypted at runtime when an agent needs it.",
    code: "openclaw secrets set ANTHROPIC_API_KEY",
    label: "Add a secret interactively",
    tip: "The command prompts for the value so it never appears in your shell history. Never pass secrets as command-line arguments.",
  },
  {
    number: 4,
    title: "Create scoped API tokens with least-privilege permissions",
    description:
      "Rather than sharing one admin token across all your agents, follow the principle of least privilege and create scoped API tokens. Each token can be restricted to specific agents, actions, and expiration times.",
    code: "openclaw token create \\\n  --name \"news-agent\" \\\n  --scope agents:read,agents:execute \\\n  --agent news-summarizer \\\n  --expires 30d",
    label: "Create a scoped token",
    output:
      'Token created:\n  Name:    news-agent\n  Scope:   agents:read, agents:execute\n  Agent:   news-summarizer\n  Expires: 2026-04-14\n  Token:   ocat_scoped_x9y8z7w6...\n\nAdd to your agent config:\n  auth_token = "ocat_scoped_x9y8z7w6..."',
  },
  {
    number: 5,
    title: "Configure API rate limiting on the gateway",
    description:
      "API rate limiting protects your OpenClaw gateway from runaway agents, denial-of-service abuse, and unexpected traffic spikes. Set a requests-per-minute cap globally and per-token. The defaults are generous — tighten them based on your expected usage.",
    code: "openclaw gateway ratelimit \\\n  --global 200/min \\\n  --per-token 60/min \\\n  --burst 10",
    label: "Set rate limits",
    output: "Rate limiting configured:\n  Global:    200 req/min\n  Per-token:  60 req/min\n  Burst:      10 requests",
  },
  {
    number: 6,
    title: "Enable TLS with a trusted SSL certificate",
    description:
      "The gateway starts with a self-signed certificate, which is fine for local development. For production, configure TLS with a trusted SSL certificate and private key. If you don't have one, OpenClaw can provision a certificate automatically via Let's Encrypt.",
    code: "openclaw gateway tls \\\n  --cert /etc/ssl/certs/gateway.pem \\\n  --key /etc/ssl/private/gateway-key.pem",
    label: "Configure TLS with your own certificate",
    tip: "For local development, the self-signed cert is fine. For anything exposed to the network, use a real cert.",
  },
  {
    number: 7,
    title: "Restrict allowed origins with a CORS policy",
    description:
      "If your gateway serves a web dashboard or accepts cross-origin requests, configure a CORS policy to lock down which origins are permitted. This prevents unauthorized websites from making API requests to your gateway.",
    code: "openclaw gateway cors \\\n  --allow-origin \"https://yourdomain.com\" \\\n  --allow-methods \"GET,POST\" \\\n  --allow-headers \"Authorization,Content-Type\"",
    label: "Set CORS policy",
  },
  {
    number: 8,
    title: "Set up HMAC-SHA256 webhook request signing",
    description:
      "If your agents send or receive webhooks, enable request signing so both sides can verify the authenticity of each payload. OpenClaw signs webhook requests with HMAC-SHA256 and includes the signature in the X-OpenClaw-Signature header.",
    code: "openclaw webhooks sign enable \\\n  --secret $(openssl rand -hex 32)",
    label: "Enable webhook signing",
    output: "Webhook signing enabled.\nSignature header: X-OpenClaw-Signature\nAlgorithm: HMAC-SHA256",
    tip: "Share the signing secret with your webhook consumer through a secure channel, not in code or chat.",
  },
  {
    number: 9,
    title: "Review and rotate tokens",
    description:
      "List all active tokens to see what's in use. Rotate any token that may have been exposed, and revoke tokens for agents you've decommissioned. Make token rotation a regular habit.",
    code: "openclaw token list",
    label: "List all active tokens",
    output:
      "NAME            SCOPE                    AGENT              EXPIRES      LAST USED\nadmin           *                        *                  never        2 min ago\nnews-agent      agents:read,execute      news-summarizer    2026-04-14   1 hour ago\nslack-bot       agents:read,execute      slack-responder    2026-05-01   3 days ago",
  },
  {
    number: 10,
    title: "Verify your setup",
    description:
      "Run the security audit again. You should see all checks passing. If anything is still flagged, the output will tell you exactly what to fix.",
    code: "openclaw security audit",
    label: "Run the audit again",
    output:
      "Scanning gateway config...\n✓ Gateway auth: enabled (token-based)\n✓ API keys: 1 stored (encrypted)\n✓ Rate limiting: 200/min global, 60/min per-token\n✓ TLS: enabled (valid certificate)\n✓ CORS: restricted\n✓ Webhook signing: enabled\n\n0 issues found. Your gateway is secure.",
  },
];

const troubleshooting = [
  {
    problem: "\"401 Unauthorized\" when calling the gateway",
    solution:
      'Make sure you\'re passing your token in the Authorization header:\ncurl -H "Authorization: Bearer ocat_your_token" http://127.0.0.1:18789/api/agents',
  },
  {
    problem: "\"rate limit exceeded\" errors during normal usage",
    solution:
      "openclaw gateway ratelimit --per-token 120/min --burst 20",
  },
  {
    problem: "Forgot or lost your admin token",
    solution:
      "openclaw token reset --admin\n# This revokes the old token and generates a new one.",
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
          Agent Authentication &amp; API Security
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Lock down your OpenClaw gateway with token-based auth, encrypted
          secrets, rate limiting, and TLS &mdash; so your agents stay safe in
          production.
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
