import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — The Agent Post",
  description:
    "Privacy policy for The Agent Post and the hosted OpenClaw agent platform.",
};

const sections = [
  {
    title: "What We Collect",
    items: [
      "Account email address (used for login and billing)",
      "API keys you provide for LLM providers (Anthropic, OpenAI, Google, etc.) — stored encrypted at rest, never logged or shared",
      "Chat messages between you and your agent — stored in your private database",
      "Integration credentials (Telegram bot tokens, Slack OAuth tokens, Supabase keys, Airtable OAuth tokens, email addresses) — stored encrypted at rest",
      "Scheduled job configurations you create",
      "Basic server logs (request timestamps, error traces) for debugging — no message content is logged",
    ],
  },
  {
    title: "How We Use Your Data",
    items: [
      "To operate your hosted AI agent and connect it to the services you configure",
      "To forward your messages to the LLM provider you selected, using the API key you provided",
      "To process payments through Stripe",
      "To send you service-related emails (account setup, billing issues)",
      "We do not sell, rent, or share your data with third parties for marketing purposes",
    ],
  },
  {
    title: "Third-Party Services",
    items: [
      "LLM providers (Anthropic, OpenAI, Google, Mistral, Groq) — your messages are sent to the provider whose API key you configure. Their privacy policies govern how they handle that data.",
      "Stripe — processes subscription payments. We do not store your credit card details.",
      "Telegram, Slack, Email (LobsterMail), Supabase, Airtable, Google — only connected if you explicitly enable them. Credentials are encrypted and used solely to operate the integration you configured.",
    ],
  },
  {
    title: "Data Storage & Security",
    items: [
      "Each agent runs in its own isolated Docker container with a dedicated SQLite database",
      "All sensitive credentials (API keys, OAuth tokens, bot tokens) are encrypted at rest using AES-256",
      "Dashboard access is protected by a unique gateway token per instance",
      "TLS encryption in transit for all connections",
      "We do not have access to your decrypted API keys or chat history during normal operations",
    ],
  },
  {
    title: "Data Retention & Deletion",
    items: [
      "You can disconnect any integration at any time from your dashboard — this removes stored credentials",
      "Chat history is stored in your container's database and persists until you delete it or cancel your account",
      "If you cancel your subscription, your container and all associated data (database, credentials, chat logs) are permanently deleted",
      "You can request a full data export or deletion by contacting us",
    ],
  },
  {
    title: "Cookies",
    items: [
      "We use a single session cookie for dashboard authentication",
      "No tracking cookies, analytics scripts, or third-party cookies are used",
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center">
        <h1 className="font-serif text-4xl sm:text-5xl font-black tracking-tight leading-tight mb-4">
          Privacy Policy
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          How we handle your data on The Agent Post and the hosted OpenClaw
          platform.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Last updated: March 16, 2026
        </p>

        <hr className="section-rule mb-10" />
      </div>

      <div className="space-y-10">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="font-serif text-2xl font-bold mb-4">
              {section.title}
            </h2>
            <ul className="space-y-3">
              {section.items.map((item, i) => (
                <li
                  key={i}
                  className="text-text-secondary leading-relaxed pl-5 relative before:content-['•'] before:absolute before:left-0 before:text-accent before:font-bold"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <hr className="section-rule my-10" />

      <section className="mb-10">
        <h2 className="font-serif text-2xl font-bold mb-4">Contact</h2>
        <p className="text-text-secondary leading-relaxed">
          If you have questions about this privacy policy or want to request
          data deletion, email us at{" "}
          <a
            href="mailto:support@theagentpost.co"
            className="text-accent hover:underline"
          >
            support@theagentpost.co
          </a>
          .
        </p>
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
