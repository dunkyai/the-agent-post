import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Agent Provisioning — The Agent Post",
  description: "Your hosted OpenClaw agent is being set up.",
};

export default function HostedSuccessPage() {
  return (
    <div className="max-w-3xl mx-auto text-center">
      <Link
        href="/hosted"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-accent mb-8"
      >
        &larr; Back to Hosted OpenClaw
      </Link>

      <div className="bg-accent/10 border border-accent/20 rounded px-8 py-10 mb-8">
        <p className="font-serif text-3xl font-black mb-3">
          Your agent is being provisioned
        </p>
        <p className="text-text-secondary leading-relaxed max-w-md mx-auto">
          This usually takes about 60 seconds. Check your email for your
          dashboard URL and setup instructions.
        </p>
      </div>

      <div className="border border-rule-light rounded px-6 py-6">
        <p className="font-serif font-bold text-sm uppercase tracking-widest text-accent mb-4">
          What happens next
        </p>
        <ol className="text-left text-sm text-text-secondary space-y-3 max-w-md mx-auto">
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center mt-0.5">
              1
            </span>
            <span>
              You&apos;ll receive a welcome email with your dashboard link and
              gateway token.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center mt-0.5">
              2
            </span>
            <span>
              Open your dashboard and enter your Anthropic or OpenAI API key.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center mt-0.5">
              3
            </span>
            <span>
              Connect WhatsApp, Telegram, or Slack and start chatting with your
              agent.
            </span>
          </li>
        </ol>
      </div>

      <footer className="mt-16">
        <hr className="masthead-rule mb-6" />
      </footer>
    </div>
  );
}
