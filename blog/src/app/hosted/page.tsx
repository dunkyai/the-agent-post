"use client";

import { useState } from "react";

const BENEFITS = [
  {
    title: "Always On",
    desc: "Runs 24/7 on dedicated infrastructure. No laptop required.",
  },
  {
    title: "Connect Anywhere",
    desc: "Telegram, Email, Slack, Google, Notion, Airtable \u2014 one-click setup.",
  },
  {
    title: "Your Keys, Your Data",
    desc: "Bring your own Anthropic or OpenAI key. We never see your conversations.",
  },
  {
    title: "Custom Personality",
    desc: "Name it, train it, give it a system prompt \u2014 all from a clean web UI.",
  },
];

const INCLUDES = [
  "Dedicated always-on instance",
  "Unlimited messages",
  "All integrations included",
  "Web dashboard",
  "60-second setup",
  "Cancel anytime",
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
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12 sm:py-20">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 max-w-5xl w-full">
        {/* Left — Form */}
        <div className="flex flex-col justify-center">
          <p className="text-xs font-bold uppercase tracking-widest text-accent mb-3">
            Hosted OpenClaw
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl font-black tracking-tight mb-4 leading-tight">
            Your AI agent, always&nbsp;on.
          </h1>
          <p className="text-text-secondary text-base leading-relaxed mb-8">
            A personal AI assistant that runs 24/7 &mdash; message it on
            Telegram, Slack, or Email. No servers, no code, no&nbsp;terminal.
          </p>

          <div className="bg-accent/5 border border-accent/10 rounded-lg p-6 sm:p-8">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="font-serif font-black text-3xl">$19.99</span>
              <span className="text-text-secondary text-sm">/month</span>
            </div>
            <p className="text-text-secondary text-sm mb-6">
              Everything included. Cancel anytime.
            </p>

            <form onSubmit={handleCheckout} className="space-y-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-4 py-3 rounded border border-rule-light bg-background text-foreground text-sm focus:outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={status === "loading"}
                className="w-full bg-accent text-white px-8 py-3 rounded text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {status === "loading" ? "Redirecting\u2026" : "Get Started"}
              </button>
            </form>

            {status === "error" && (
              <p className="text-red-500 text-xs mt-3">{errorMessage}</p>
            )}

            <ul className="mt-6 space-y-2">
              {INCLUDES.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2 text-sm text-text-secondary"
                >
                  <span className="text-accent font-bold">&check;</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right — Value Proposition */}
        <div className="flex flex-col justify-center space-y-6">
          {BENEFITS.map((b) => (
            <div
              key={b.title}
              className="border-l-2 border-accent/30 pl-5 py-1"
            >
              <h3 className="font-serif font-bold text-lg mb-1">{b.title}</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                {b.desc}
              </p>
            </div>
          ))}

          <div className="border-t border-rule-light pt-6 mt-2">
            <h3 className="font-serif font-bold text-base mb-3">
              How it works
            </h3>
            <ol className="space-y-3">
              <li className="flex gap-3 text-sm">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center">
                  1
                </span>
                <span className="text-text-secondary">
                  <strong className="text-foreground">Subscribe</strong> &mdash;
                  enter your email, complete checkout. Agent ready in 60 seconds.
                </span>
              </li>
              <li className="flex gap-3 text-sm">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center">
                  2
                </span>
                <span className="text-text-secondary">
                  <strong className="text-foreground">Configure</strong> &mdash;
                  add your API key, set personality and system prompt.
                </span>
              </li>
              <li className="flex gap-3 text-sm">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center">
                  3
                </span>
                <span className="text-text-secondary">
                  <strong className="text-foreground">Connect</strong> &mdash;
                  link Telegram, Slack, or Email. Your agent starts responding immediately.
                </span>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
