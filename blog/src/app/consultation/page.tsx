"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Vapi from "@vapi-ai/web";

interface SharedItem {
  id: number;
  type: "link" | "code";
  content: string;
  label?: string;
}

const URL_REGEX = /https?:\/\/[^\s),]+/g;
const CODE_REGEX =
  /(?:^|\s)((?:npm |npx |curl |git |cd |pip |brew |docker |mkdir |sudo |cat |echo |export |source |python |node |bun |pnpm |yarn )\S.*?)(?:\.\s|$)/gi;

function extractItems(text: string, existingUrls: Set<string>): SharedItem[] {
  const items: SharedItem[] = [];

  const urls = text.match(URL_REGEX) || [];
  for (const url of urls) {
    const clean = url.replace(/[.,;:!?)]+$/, "");
    if (!existingUrls.has(clean)) {
      existingUrls.add(clean);
      items.push({ id: 0, type: "link", content: clean });
    }
  }

  const codeMatches = text.matchAll(CODE_REGEX);
  for (const match of codeMatches) {
    const cmd = match[1].trim();
    if (cmd.length > 5 && !existingUrls.has(cmd)) {
      existingUrls.add(cmd);
      items.push({ id: 0, type: "code", content: cmd });
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
      // Extract from AI transcript
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

      // Also handle tool calls if configured
      if (message.type === "tool-calls") {
        const toolCalls = message.toolCallList || [];
        toolCalls.forEach((toolCall: any) => {
          const fn = toolCall.function?.name;
          const args = JSON.parse(toolCall.function?.arguments || "{}");

          if (fn === "display_link" && args.url) {
            if (!seenRef.current.has(args.url)) {
              seenRef.current.add(args.url);
              setSharedItems((prev) => [
                ...prev,
                {
                  id: ++itemIdRef.current,
                  type: "link",
                  content: args.url,
                  label: args.label,
                },
              ]);
            }
          } else if (fn === "display_code" && args.code) {
            setSharedItems((prev) => [
              ...prev,
              {
                id: ++itemIdRef.current,
                type: "code",
                content: args.code,
                label: args.label,
              },
            ]);
          }
        });
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                  {item.type === "link" ? (
                    <a
                      href={item.content}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline text-sm font-mono break-all"
                    >
                      {item.content}
                    </a>
                  ) : (
                    <pre className="text-xs font-mono bg-background rounded p-3 overflow-x-auto whitespace-pre-wrap">
                      {item.content}
                    </pre>
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
