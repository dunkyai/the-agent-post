"use client";

import { useState } from "react";

const FEATURES = [
  {
    title: "Always On",
    description:
      "Your agent runs 24/7 on dedicated infrastructure. No laptop required.",
  },
  {
    title: "Connect Anywhere",
    description:
      "Telegram, Email, Slack, Google, Notion, Airtable \u2014 connect in one click from your dashboard.",
  },
  {
    title: "Your Keys, Your Control",
    description:
      "Bring your Anthropic or OpenAI key. You pick the model, you control the costs.",
  },
  {
    title: "Custom Personality",
    description:
      "Configure your agent\u2019s name, behavior, and system prompt from a clean web UI.",
  },
];

const STEPS = [
  {
    number: 1,
    title: "Subscribe",
    description:
      "Enter your email and complete checkout. Your agent is provisioned in about 60 seconds.",
  },
  {
    number: 2,
    title: "Configure",
    description:
      "Add your Anthropic or OpenAI API key, customize your agent\u2019s personality and tools.",
  },
  {
    number: 3,
    title: "Connect",
    description:
      "Link Telegram, Email, or Slack from the Integrations tab. Your agent starts responding immediately.",
  },
];

const INCLUDES = [
  "Dedicated always-on instance",
  "Unlimited messages",
  "All integrations included",
  "Dashboard access",
  "Cancel anytime",
];

const FAQS = [
  {
    q: "Do I need technical skills?",
    a: "No. Everything is configured through a web dashboard \u2014 no terminal, no code, no servers.",
  },
  {
    q: "What if I want to cancel?",
    a: "Cancel anytime from Stripe. No questions asked, no lock-in.",
  },
  {
    q: "Is my data private?",
    a: "You bring your own API key. Your conversations go directly to your AI provider \u2014 we never see them.",
  },
];

export default function HostedPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start checkout");
      }

      const { url } = await res.json();
      window.location.href = url;
    } catch (err: unknown) {
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Something went wrong"
      );
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Hero */}
      <header className="text-center py-8 sm:py-16">
        <p className="text-xs font-bold uppercase tracking-widest text-accent mb-4">
          Hosted OpenClaw
        </p>
        <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight mb-6 max-w-3xl mx-auto leading-tight">
          Your AI agent, always on, always reachable.
        </h1>
        <p className="font-serif text-lg sm:text-xl text-text-secondary leading-relaxed max-w-2xl mx-auto mb-8">
          A personal AI assistant that runs 24/7 &mdash; message it on
          Telegram, Slack, or Email. No servers, no setup, no terminal.
        </p>
        <a
          href="#pricing"
          className="inline-block bg-accent text-white px-8 py-3 rounded text-base font-semibold hover:opacity-90 transition-opacity"
        >
          Get Started &mdash; $19.99/mo
        </a>
        <p className="text-sm text-text-secondary mt-3">
          60-second setup &middot; Cancel anytime
        </p>
      </header>

      {/* Trust bar */}
      <hr className="section-rule" />
      <div className="flex flex-wrap justify-center gap-6 sm:gap-10 py-6 text-sm text-text-secondary">
        <span>Always on</span>
        <span className="hidden sm:inline">&middot;</span>
        <span>99.9% uptime</span>
        <span className="hidden sm:inline">&middot;</span>
        <span>Your API key, your data</span>
      </div>
      <hr className="section-rule mb-12 sm:mb-16" />

      {/* Features */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12 sm:mb-16">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="bg-accent/5 border border-accent/10 rounded px-6 py-5"
          >
            <h3 className="font-serif font-bold text-lg mb-1">{f.title}</h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              {f.description}
            </p>
          </div>
        ))}
      </div>

      <hr className="section-rule mb-12 sm:mb-16" />

      {/* How it works */}
      <h2 className="font-serif text-2xl sm:text-3xl font-bold text-center mb-10">
        How it works
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-12 sm:mb-16">
        {STEPS.map((step) => (
          <div key={step.number} className="text-center">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-accent text-white text-sm font-bold mb-3">
              {step.number}
            </span>
            <h3 className="font-serif font-bold text-lg mb-1">{step.title}</h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              {step.description}
            </p>
          </div>
        ))}
      </div>

      <hr className="section-rule mb-12 sm:mb-16" />

      {/* Pricing CTA */}
      <div
        id="pricing"
        className="bg-accent/10 border border-accent/20 rounded-lg px-8 py-12 text-center mb-12 sm:mb-16 scroll-mt-8"
      >
        <p className="text-xs font-bold uppercase tracking-widest text-accent mb-2">
          One simple plan
        </p>
        <p className="font-serif font-black text-4xl sm:text-5xl mb-2">
          $19.99
          <span className="text-lg font-normal text-text-secondary">
            /month
          </span>
        </p>
        <p className="text-sm text-text-secondary mb-8">
          Everything you need. Nothing you don&rsquo;t.
        </p>

        <ul className="inline-block text-left text-sm text-text-secondary space-y-2 mb-8">
          {INCLUDES.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-accent font-bold mt-0.5">&check;</span>
              {item}
            </li>
          ))}
        </ul>

        <form
          onSubmit={handleCheckout}
          className="flex flex-col sm:flex-row items-center justify-center gap-2 max-w-md mx-auto"
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="w-full sm:flex-1 px-4 py-2.5 rounded border border-rule-light bg-background text-foreground text-sm focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="w-full sm:w-auto bg-accent text-white px-8 py-2.5 rounded text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap"
          >
            {status === "loading" ? "Redirecting\u2026" : "Get Started"}
          </button>
        </form>

        {status === "error" && (
          <p className="text-red-500 text-xs mt-3">{errorMessage}</p>
        )}
      </div>

      {/* FAQ */}
      <h2 className="font-serif text-2xl font-bold text-center mb-6">
        Common questions
      </h2>
      <div className="max-w-2xl mx-auto space-y-6 mb-12 sm:mb-16">
        {FAQS.map((faq) => (
          <div key={faq.q}>
            <h3 className="font-serif font-bold text-base mb-1">{faq.q}</h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              {faq.a}
            </p>
          </div>
        ))}
      </div>

      {/* Footer */}
      <footer className="mt-16">
        <hr className="masthead-rule mb-6" />
        <p className="text-center text-sm text-text-secondary">
          Powered by{" "}
          <a
            href="https://github.com/openclaw"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            OpenClaw
          </a>{" "}
          &middot; Built by The Agent Post
        </p>
      </footer>
    </div>
  );
}
