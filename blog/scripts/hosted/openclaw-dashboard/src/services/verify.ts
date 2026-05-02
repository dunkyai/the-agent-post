/**
 * Post-action verification using Haiku as a lightweight auditor.
 * Only runs on high-stakes actions (sending emails, posting social, creating contracts).
 * Checks that the AI actually did what it claims and followed instructions.
 */

// High-stakes tools that trigger verification
const HIGH_STAKES_TOOLS = new Set([
  "gmail_send",
  "gmail_create_draft",
  "twitter_post_tweet",
  "twitter_post_thread",
  "buffer_create_post",
  "beehiiv_create_draft",
  "agree_create_agreement",
  "agree_create_and_send",
  "agree_send_agreement",
  "send_slack",
  "luma_create_event",
  "calendar_create_event",
]);

interface ToolCallRecord {
  name: string;
  input: any;
  output: string;
}

/**
 * Check if any tool calls in this session were high-stakes.
 */
export function hasHighStakesActions(toolNames: string[]): boolean {
  return toolNames.some(t => HIGH_STAKES_TOOLS.has(t));
}

/**
 * Verify the AI's response against what it actually did.
 * Uses Haiku for a fast, cheap check.
 * Returns null if verification passes, or a warning message if issues found.
 */
export async function verifyResponse(
  userInput: string,
  aiResponse: string,
  toolCalls: ToolCallRecord[]
): Promise<string | null> {
  // Only verify if high-stakes tools were used
  const highStakesCalls = toolCalls.filter(t => HIGH_STAKES_TOOLS.has(t.name));
  if (highStakesCalls.length === 0) return null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    // Build a summary of what was actually done
    const actionSummary = highStakesCalls.map(t => {
      const output = t.output.slice(0, 200);
      return `Tool: ${t.name}\nInput: ${JSON.stringify(t.input).slice(0, 200)}\nResult: ${output}`;
    }).join("\n\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: `You are a verification agent. Check if the AI's response accurately describes what it actually did. ONLY flag serious issues:
1. Claims of actions not in the tool log (hallucination — the AI said it did something but never called the tool)
2. Wrong recipients (emailed/messaged the wrong person)
3. Missing actions that the user explicitly requested but weren't performed

Do NOT flag:
- Minor formatting differences
- Truncated text in tool output summaries (the output shown here may be abbreviated)
- Content style preferences
- Anything that is merely a nitpick rather than a real error

User's request: "${userInput.slice(0, 300)}"

AI's response: "${aiResponse.slice(0, 500)}"

Actual tool calls:
${actionSummary}

If everything checks out, respond with exactly: PASS
If there are issues, respond with: FAIL: [brief description of the issue]`,
        }],
      }),
    });

    if (!res.ok) return null; // Don't block on verification failure

    const data: any = await res.json();
    const verdict = (data.content?.[0]?.text || "").trim();

    if (verdict.startsWith("PASS")) {
      console.log(`[verify] High-stakes verification PASSED (${highStakesCalls.length} action(s))`);
      return null;
    }

    if (verdict.startsWith("FAIL")) {
      const issue = verdict.replace(/^FAIL:\s*/i, "");
      console.warn(`[verify] High-stakes verification FAILED: ${issue}`);
      return issue;
    }

    // Ambiguous response — treat as pass
    return null;
  } catch (err) {
    console.error("[verify] Verification error:", err instanceof Error ? err.message : err);
    return null; // Don't block on errors
  }
}
