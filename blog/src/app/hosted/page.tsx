"use client";

import { useState } from "react";

const FEATURES = [
  {
    title: "Always-on AI agent",
    description:
      "Your agent runs 24/7 on dedicated infrastructure. No laptop required.",
  },
  {
    title: "Chat app integrations",
    description:
      "Connect WhatsApp, Telegram, or Slack in minutes from the dashboard.",
  },
  {
    title: "Web dashboard",
    description:
      "Configure your agent's personality, tools, and behavior from a clean UI.",
  },
  {
    title: "Bring your own API key",
    description:
      "Use your Anthropic or OpenAI key. You control the model and the costs.",
  },
];

export default function HostedPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
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
    <div className="max-w-3xl mx-auto">
      <header className="text-center mb-12">
        <p className="text-xs font-bold uppercase tracking-widest text-accent mb-3">
          Hosted OpenClaw
        </p>
        <h1 className="font-serif text-4xl sm:text-5xl font-black tracking-tight mb-4">
          An AI agent that lives in your WhatsApp, Telegram, or Slack
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed">
          No setup, no servers. Get a fully managed AI agent in 60 seconds.
        </p>
      </header>

      <hr className="section-rule mb-10" />

      {/* Features */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="border border-rule-light rounded px-6 py-5"
          >
            <h3 className="font-serif font-bold text-lg mb-1">
              {feature.title}
            </h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              {feature.description}
            </p>
          </div>
        ))}
      </div>

      <hr className="section-rule mb-10" />

      {/* Pricing + CTA */}
      <div className="bg-accent/10 border border-accent/20 rounded px-8 py-10 text-center mb-12">
        <p className="font-serif font-bold text-2xl mb-1">$49/month</p>
        <p className="text-sm text-text-secondary mb-6">
          Dedicated instance &middot; unlimited messages &middot; cancel
          anytime
        </p>

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
            className="w-full sm:flex-1 px-4 py-2 rounded border border-rule-light bg-background text-foreground text-sm focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="bg-accent text-white px-6 py-2 rounded text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap"
          >
            {status === "loading" ? "Redirecting..." : "Get Started"}
          </button>
        </form>

        {status === "error" && (
          <p className="text-red-500 text-xs mt-3">{errorMessage}</p>
        )}
      </div>

      {/* How it works */}
      <h2 className="font-serif text-2xl font-bold text-center mb-6">
        How it works
      </h2>
      <div className="space-y-6 mb-12">
        {[
          {
            number: 1,
            title: "Subscribe",
            description:
              "Enter your email and complete checkout. Your agent is provisioned automatically in about 60 seconds.",
          },
          {
            number: 2,
            title: "Configure",
            description:
              "Open your dashboard, add your Anthropic or OpenAI API key, and customize your agent's behavior.",
          },
          {
            number: 3,
            title: "Connect",
            description:
              "Link WhatsApp, Telegram, or Slack from the Integrations tab. Your agent starts responding immediately.",
          },
        ].map((step) => (
          <div key={step.number} className="flex items-start gap-4">
            <span className="flex-shrink-0 w-8 h-8 rounded-full bg-accent text-white text-sm font-bold flex items-center justify-center">
              {step.number}
            </span>
            <div>
              <h3 className="font-serif font-bold text-lg">{step.title}</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>

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
