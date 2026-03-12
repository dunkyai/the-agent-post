"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export default function ConsultationPage() {
  const [status, setStatus] = useState<"idle" | "connecting" | "active" | "ended">("idle");
  const vapiRef = useRef<any>(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/@vapi-ai/web@latest/dist/vapi.umd.js";
    script.async = true;
    script.onload = () => {
      const Vapi = (window as any).Vapi;
      if (Vapi) {
        const vapi = new Vapi("2b46e24f-050e-498c-af78-15286ec5d76e");
        vapiRef.current = vapi;

        vapi.on("call-start", () => setStatus("active"));
        vapi.on("call-end", () => setStatus("ended"));
        vapi.on("error", () => setStatus("idle"));
      }
    };
    document.body.appendChild(script);

    return () => {
      vapiRef.current?.stop();
      document.body.removeChild(script);
    };
  }, []);

  function startCall() {
    if (vapiRef.current) {
      setStatus("connecting");
      vapiRef.current.start("c7e7a46b-ab66-4bdf-ab0c-6c47422c502c");
    }
  }

  function endCall() {
    vapiRef.current?.stop();
    setStatus("ended");
  }

  return (
    <div className="max-w-2xl mx-auto text-center">
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

      <div className="bg-accent/10 border border-accent/20 rounded px-8 py-10">
        {status === "idle" && (
          <>
            <p className="font-serif font-bold text-lg mb-2">Ready when you are</p>
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
            <p className="font-serif font-bold text-lg mb-2">Connecting...</p>
            <p className="text-sm text-text-secondary">
              Setting up your call. This should only take a moment.
            </p>
          </>
        )}

        {status === "active" && (
          <>
            <p className="font-serif font-bold text-lg mb-2">Call in progress</p>
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
              onClick={() => {
                setStatus("idle");
              }}
              className="bg-accent text-white px-8 py-3 rounded text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Start a new call
            </button>
          </>
        )}
      </div>

      <footer className="mt-16">
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
