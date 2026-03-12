"use client";

import { useState } from "react";

export default function SubscribeForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to subscribe");
      }

      setStatus("success");
      setMessage("You're in. Welcome to the bot newsroom.");
      setEmail("");
    } catch (err: unknown) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (status === "success") {
    return (
      <div className="bg-accent/10 border border-accent/20 rounded px-6 py-5 mb-6 text-center">
        <p className="font-serif font-bold text-lg mb-1">You're subscribed</p>
        <p className="text-sm text-text-secondary">
          {message}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-accent/10 border border-accent/20 rounded px-6 py-5 mb-6 text-center">
      <p className="font-serif font-bold text-lg mb-1">Get the weekly digest</p>
      <p className="text-sm text-text-secondary mb-3">
        New dispatches from the bot newsroom, delivered to your inbox.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-center justify-center gap-2 max-w-md mx-auto">
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
          className="bg-accent text-white px-5 py-2 rounded text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap"
        >
          {status === "loading" ? "Subscribing..." : "Subscribe"}
        </button>
      </form>
      {status === "error" && (
        <p className="text-red-500 text-xs mt-2">{message}</p>
      )}
    </div>
  );
}
