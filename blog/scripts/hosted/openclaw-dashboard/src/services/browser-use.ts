/**
 * Browser Use Cloud integration — AI-controlled browser for form filling
 * and complex web interactions. Uses the Browser Use Cloud REST API.
 * https://docs.browser-use.com/cloud/api-reference
 */

const BROWSER_USE_API = "https://api.browser-use.com/api/v3";

function getApiKey(): string {
  const key = process.env.BROWSER_USE_API_KEY;
  if (!key) throw new Error("Browser Use is not configured. Add BROWSER_USE_API_KEY to Doppler.");
  return key;
}

export function isBrowserUseAvailable(): boolean {
  return !!process.env.BROWSER_USE_API_KEY;
}

/**
 * Run a browser task using natural language instructions.
 * The AI agent navigates, fills forms, clicks buttons, etc.
 */
export async function browserUseRun(input: {
  task: string;
  url?: string;
  model?: string;
}): Promise<string> {
  const apiKey = getApiKey();

  // If a URL is provided, prepend it to the task
  const fullTask = input.url
    ? `Go to ${input.url} and then: ${input.task}`
    : input.task;

  try {
    // Create and run a session
    const createRes = await fetch(`${BROWSER_USE_API}/sessions`, {
      method: "POST",
      headers: {
        "X-Browser-Use-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: fullTask,
        model: input.model || "claude-sonnet-4-6",
        keepAlive: false,
      }),
    });

    if (!createRes.ok) {
      const err: any = await createRes.json().catch(() => ({}));
      return JSON.stringify({ error: err.message || `Browser Use API error (${createRes.status})` });
    }

    const session: any = await createRes.json();
    const sessionId = session.id;

    if (!sessionId) {
      return JSON.stringify({ error: "Failed to create browser session" });
    }

    console.log(`[browser-use] Session ${sessionId} created for task: ${fullTask.slice(0, 100)}...`);

    // Poll for completion (max 5 minutes)
    const maxWait = 5 * 60 * 1000;
    const pollInterval = 3000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, pollInterval));

      const pollRes = await fetch(`${BROWSER_USE_API}/sessions/${sessionId}`, {
        headers: { "X-Browser-Use-API-Key": apiKey },
      });

      if (!pollRes.ok) continue;

      const status: any = await pollRes.json();

      if (status.status === "error" || status.status === "timed_out") {
        return JSON.stringify({
          error: `Browser task failed: ${status.lastStepSummary || status.status}`,
          sessionId,
        });
      }

      if (status.status === "stopped" || status.status === "idle") {
        // Task completed
        const result: any = {
          success: true,
          sessionId,
          output: status.output || status.lastStepSummary || "Task completed",
          taskSuccessful: status.isTaskSuccessful ?? true,
          cost: status.totalCostUsd,
        };

        if (status.liveUrl) {
          result.liveUrl = status.liveUrl;
        }

        console.log(`[browser-use] Session ${sessionId} completed (${Math.round((Date.now() - start) / 1000)}s, $${status.totalCostUsd || "?"})`);
        return JSON.stringify(result);
      }

      // Still running — log progress
      if (status.lastStepSummary) {
        console.log(`[browser-use] ${sessionId}: ${status.lastStepSummary}`);
      }
    }

    // Timeout — stop the session
    await fetch(`${BROWSER_USE_API}/sessions/${sessionId}/stop`, {
      method: "POST",
      headers: {
        "X-Browser-Use-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ strategy: "session" }),
    }).catch(() => {});

    return JSON.stringify({
      error: "Browser task timed out after 5 minutes",
      sessionId,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Browser Use request failed" });
  }
}
