/**
 * Agnost AI integration — sends conversation events for monitoring and analysis.
 * Uses the REST API directly (no SDK dependency).
 */

const AGNOST_API = "https://api.agnost.ai";
const ORG_ID = process.env.AGNOST_ORG_ID || "";

let enabled = false;

export function startAgnost(): void {
  if (ORG_ID) {
    enabled = true;
    console.log("Agnost connected");
  }
}

export function isAgnostRunning(): boolean {
  return enabled;
}

// --- Session tracking ---

export async function captureSession(params: {
  sessionId: string;
  userId?: string;
  agentName?: string;
  tools?: string[];
  source?: string;
}): Promise<string | null> {
  if (!enabled) return null;
  try {
    const res = await fetch(`${AGNOST_API}/api/v1/capture-session`, {
      method: "POST",
      headers: {
        "X-Org-Id": ORG_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: params.sessionId,
        user_data: {
          user_id: params.userId,
          agent_name: params.agentName,
          source: params.source,
        },
        connection_type: "http",
        tools: params.tools || [],
      }),
    });

    if (!res.ok) {
      console.error(`[agnost] capture-session error (${res.status}):`, await res.text());
      return null;
    }

    const data: any = await res.json();
    return data.session_id || null;
  } catch (err) {
    console.error("[agnost] capture-session failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// --- Event tracking ---

export async function captureEvent(params: {
  sessionId: string;
  toolName: string;
  toolType?: "tool" | "resource" | "prompt";
  success: boolean;
  latencyMs: number;
  input?: any;
  output?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  if (!enabled) return;
  try {
    const res = await fetch(`${AGNOST_API}/api/v1/capture-event`, {
      method: "POST",
      headers: {
        "X-Org-Id": ORG_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: params.sessionId,
        primitive_name: params.toolName,
        primitive_type: params.toolType || "tool",
        success: params.success,
        latency: params.latencyMs,
        args: params.input ? JSON.stringify(params.input).slice(0, 2000) : undefined,
        result: params.output?.slice(0, 2000),
        metadata: params.metadata,
      }),
    });

    if (!res.ok) {
      console.error(`[agnost] capture-event error (${res.status}):`, await res.text());
    }
  } catch (err) {
    // Fire and forget — don't let analytics failures affect the agent
    console.error("[agnost] capture-event failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Track a complete task — call this after task processing completes.
 * Creates a session (if needed) and captures the main AI event + tool call events.
 */
export async function trackTask(params: {
  taskId: string;
  sessionId: string;
  source: string;
  agentName?: string;
  userInput: string;
  aiOutput: string;
  success: boolean;
  durationMs: number;
  model?: string;
  toolCalls?: { tool: string; input?: any; output?: string; durationMs: number; success: boolean }[];
}): Promise<void> {
  if (!enabled) return;

  try {
    // Capture session
    await captureSession({
      sessionId: params.sessionId,
      agentName: params.agentName,
      source: params.source,
    });

    // Capture individual tool call events
    if (params.toolCalls?.length) {
      for (const tc of params.toolCalls) {
        await captureEvent({
          sessionId: params.sessionId,
          toolName: tc.tool,
          toolType: "tool",
          success: tc.success,
          latencyMs: tc.durationMs,
          input: tc.input,
          output: tc.output,
          metadata: { task_id: params.taskId, model: params.model },
        });
      }
    }

    // Capture the main AI response event
    await captureEvent({
      sessionId: params.sessionId,
      toolName: "ai_response",
      toolType: "prompt",
      success: params.success,
      latencyMs: params.durationMs,
      input: { user_input: params.userInput.slice(0, 1000) },
      output: params.aiOutput.slice(0, 2000),
      metadata: {
        task_id: params.taskId,
        model: params.model,
        source: params.source,
        tool_count: params.toolCalls?.length || 0,
      },
    });
  } catch (err) {
    // Never let analytics break the agent
    console.error("[agnost] trackTask failed:", err instanceof Error ? err.message : err);
  }
}
