"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Vapi from "@vapi-ai/web";

interface SharedItem {
  id: number;
  type: "link" | "code" | "text";
  content: string;
  label?: string;
}

// Keyword trigger map: when the AI says the trigger phrase, display the content.
// Each trigger has required words that must ALL appear in the transcript chunk.
// This is fuzzy — word order doesn't matter, and punctuation is stripped.
const KEYWORD_TRIGGERS: {
  words: string[];
  content: string;
  type: SharedItem["type"];
  label: string;
}[] = [
  { words: ["command", "line", "prompt"], content: "yourname@Mac-mini ~ %", type: "code", label: "Command line prompt" },
  { words: ["open", "terminal"], content: "yourname@Mac-mini ~ %", type: "code", label: "Command line prompt" },
  { words: ["install", "homebrew"], content: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', type: "code", label: "Install Homebrew" },
  { words: ["confirm", "homebrew"], content: "brew --version", type: "code", label: "Confirm Homebrew works" },
  { words: ["brew", "install", "node"], content: "brew install node", type: "code", label: "Install Node.js" },
  { words: ["verify", "node", "installation"], content: "node --version", type: "code", label: "Verify Node installation" },
  { words: ["install", "open", "claw"], content: "curl -fsSL https://openclaw.ai/install.sh | bash", type: "code", label: "Install OpenClaw" },
  { words: ["setup", "wizard"], content: "openclaw onboard --install-daemon", type: "code", label: "Run the setup wizard" },
  { words: ["claude", "account"], content: "Claude.com", type: "link", label: "Create a Claude account" },
  { words: ["api", "key"], content: "https://platform.claude.com/settings/keys", type: "link", label: "Claude API key page" },
  { words: ["key", "look", "like"], content: "sk-xxxxxxxxxxxxxxxx", type: "code", label: "API key format" },
  { words: ["start", "gateway"], content: "openclaw gateway", type: "code", label: "Start the gateway" },
  { words: ["gateway", "started"], content: "Gateway started\nListening on port 18789", type: "code", label: "Gateway has started" },
  { words: ["openclaw", "browser"], content: "http://127.0.0.1:18789", type: "link", label: "Meet OpenClaw in your browser" },
  { words: ["update", "node"], content: "brew upgrade node", type: "code", label: "Update Node.js" },
  { words: ["port", "already"], content: "openclaw doctor --fix", type: "code", label: "Fix port conflict" },
];

// Normalize text: lowercase, strip punctuation, collapse whitespace
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractItems(
  text: string,
  seen: Set<string>
): SharedItem[] {
  const items: SharedItem[] = [];
  const normed = normalize(text);

  for (const trigger of KEYWORD_TRIGGERS) {
    const key = trigger.words.join("+");
    if (seen.has(key)) continue;
    if (trigger.words.every((w) => normed.includes(w))) {
      seen.add(key);
      items.push({ id: 0, type: trigger.type, content: trigger.content, label: trigger.label });
    }
  }

  return items;
}

export default function ConsultationPage() {
  const [status, setStatus] = useState<
    "idle" | "connecting" | "active" | "ended"
  >("idle");
  const [sharedItems, setSharedItems] = useState<SharedItem[]>([]);
  const vapiRef = useRef<Vapi | null>(null);
  const itemIdRef = useRef(0);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const vapi = new Vapi("2b46e24f-050e-498c-af78-15286ec5d76e");
    vapiRef.current = vapi;

    vapi.on("call-start", () => setStatus("active"));
    vapi.on("call-end", () => setStatus("ended"));
    vapi.on("error", () => setStatus("idle"));

    vapi.on("message", (message: any) => {
      if (
        message.type === "transcript" &&
        message.role === "assistant" &&
        message.transcriptType === "final"
      ) {
        const newItems = extractItems(message.transcript, seenRef.current);
        if (newItems.length > 0) {
          setSharedItems((prev) => [
            ...prev,
            ...newItems.map((item) => ({ ...item, id: ++itemIdRef.current })),
          ]);
        }
      }
    });

    return () => {
      vapi.stop();
    };
  }, []);

  function startCall() {
    if (vapiRef.current) {
      setStatus("connecting");
      setSharedItems([]);
      seenRef.current.clear();
      vapiRef.current.start("c7e7a46b-ab66-4bdf-ab0c-6c47422c502c");
    }
  }

  function endCall() {
    vapiRef.current?.stop();
    setStatus("ended");
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-accent transition-colors mb-8"
        >
          &larr; Back to front page
        </Link>

        <h1 className="font-serif text-4xl sm:text-5xl font-black tracking-tight leading-tight mb-4">
          OpenClaw Consultation
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-10">
          Talk to an AI agent who will walk you through setting up OpenClaw.
          Setup, configuration, deployment — the works.
        </p>

        <hr className="section-rule mb-10" />
      </div>

      <div className="space-y-6">
        {/* Call controls */}
        <div className="bg-accent/10 border border-accent/20 rounded px-8 py-10 text-center">
          {status === "idle" && (
            <>
              <p className="font-serif font-bold text-lg mb-2">
                Ready when you are
              </p>
              <p className="text-sm text-text-secondary mb-6">
                Click below to start a voice call with your consultation agent.
                Make sure your microphone is enabled.
              </p>
              <button
                onClick={startCall}
                className="bg-accent text-white px-8 py-3 rounded text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Start consultation call
              </button>
            </>
          )}

          {status === "connecting" && (
            <>
              <p className="font-serif font-bold text-lg mb-2">
                Connecting...
              </p>
              <p className="text-sm text-text-secondary">
                Setting up your call. This should only take a moment.
              </p>
            </>
          )}

          {status === "active" && (
            <>
              <p className="font-serif font-bold text-lg mb-2">
                Call in progress
              </p>
              <p className="text-sm text-text-secondary mb-6">
                You&apos;re speaking with your OpenClaw consultation agent.
              </p>
              <button
                onClick={endCall}
                className="bg-red-600 text-white px-8 py-3 rounded text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                End call
              </button>
            </>
          )}

          {status === "ended" && (
            <>
              <p className="font-serif font-bold text-lg mb-2">Call ended</p>
              <p className="text-sm text-text-secondary mb-6">
                Thanks for consulting with us. Need another round?
              </p>
              <button
                onClick={() => setStatus("idle")}
                className="bg-accent text-white px-8 py-3 rounded text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Start a new call
              </button>
            </>
          )}
        </div>

        {/* Shared content panel */}
        <div className="border border-rule-light rounded px-6 py-6 min-h-[200px]">
          <p className="font-serif font-bold text-sm uppercase tracking-widest text-accent mb-4">
            Links &amp; Commands
          </p>
          {sharedItems.length === 0 ? (
            <p className="text-sm text-text-secondary italic">
              {status === "active"
                ? "URLs and commands will appear here automatically as your agent mentions them."
                : "Start a call to see shared content here."}
            </p>
          ) : (
            <div className="space-y-3">
              {sharedItems.map((item) => (
                <div
                  key={item.id}
                  className="bg-tag-bg rounded px-4 py-3 text-left"
                >
                  {item.label && (
                    <p className="text-xs text-text-secondary mb-1">
                      {item.label}
                    </p>
                  )}
                  {item.type === "link" && (
                    <a
                      href={item.content}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline text-sm font-mono break-all"
                    >
                      {item.content}
                    </a>
                  )}
                  {item.type === "code" && (
                    <pre className="text-xs font-mono bg-background rounded p-3 overflow-x-auto whitespace-pre-wrap">
                      {item.content}
                    </pre>
                  )}
                  {item.type === "text" && (
                    <p className="text-sm">{item.content}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
