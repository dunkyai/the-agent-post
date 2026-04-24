/**
 * Zod schemas for tool input validation.
 * Validates AI-provided parameters before tool execution.
 * Returns clear error messages instead of letting tools fail with cryptic errors.
 */

import { z } from "zod";

// --- High-impact tool schemas (actions that send, create, or modify) ---

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const schemas: Record<string, z.ZodType<any>> = {
  // Gmail
  gmail_send: z.object({
    to: z.string().regex(emailRegex, "Invalid email address for 'to'"),
    subject: z.string().min(1, "Subject is required"),
    body: z.string().min(1, "Body is required"),
    from: z.string().optional(),
    cc: z.string().optional(),
    thread_id: z.string().optional(),
    in_reply_to: z.string().optional(),
  }),
  gmail_create_draft: z.object({
    to: z.string().regex(emailRegex, "Invalid email address for 'to'"),
    subject: z.string().min(1, "Subject is required"),
    body: z.string().min(1, "Body is required"),
    from: z.string().optional(),
    cc: z.string().optional(),
    thread_id: z.string().optional(),
    in_reply_to: z.string().optional(),
  }),

  // Buffer
  buffer_create_post: z.object({
    channel_id: z.string().min(1, "Channel ID is required"),
    text: z.string().min(1, "Post text is required"),
    mode: z.enum(["add_to_queue", "custom_scheduled", "share_now"]).optional(),
    due_at: z.string().optional(),
  }),

  // Twitter
  twitter_post_tweet: z.object({
    text: z.string().min(1, "Tweet text is required").max(280, "Tweet exceeds 280 characters"),
  }),
  twitter_post_thread: z.object({
    tweets: z.array(z.string().min(1).max(280, "Tweet exceeds 280 characters")).min(2, "Thread needs at least 2 tweets"),
  }),

  // Google Docs
  docs_create: z.object({
    title: z.string().min(1, "Document title is required"),
    content: z.string().optional(),
  }),

  // Beehiiv
  beehiiv_create_draft: z.object({
    title: z.string().min(1, "Newsletter title is required"),
    body_content: z.string().min(1, "Newsletter body is required"),
    subtitle: z.string().optional(),
    email_subject_line: z.string().optional(),
    template_id: z.string().optional(),
  }),

  // Agree
  agree_create_agreement: z.object({
    template_id: z.string().min(1, "Template ID is required"),
    name: z.string().min(1, "Agreement name is required"),
    recipients: z.array(z.any()).optional(),
    field_values: z.record(z.string(), z.any()).optional(),
  }),
  agree_create_and_send: z.object({
    template_id: z.string().min(1, "Template ID is required"),
    name: z.string().min(1, "Agreement name is required"),
    recipients: z.array(z.any()).optional(),
    field_values: z.record(z.string(), z.any()).optional(),
  }),

  // Messaging
  send_slack: z.object({
    channel: z.string().min(1, "Slack channel ID is required"),
    message: z.string().min(1, "Message is required"),
    thread_ts: z.string().optional(),
  }),

  // Luma
  luma_create_event: z.object({
    name: z.string().min(1, "Event name is required"),
    start_at: z.string().min(1, "Start time is required"),
    end_at: z.string().min(1, "End time is required"),
    timezone: z.string().optional(),
    description: z.string().optional(),
  }),

  // Calendar
  calendar_create_event: z.object({
    summary: z.string().min(1, "Event title is required"),
    start: z.string().min(1, "Start time is required"),
    end: z.string().min(1, "End time is required"),
    description: z.string().optional(),
    location: z.string().optional(),
    attendees: z.array(z.string()).optional(),
  }),

  // ContactOut
  contactout_search_people: z.object({
    name: z.string().optional(),
    title: z.string().optional(),
    company: z.string().optional(),
  }).refine(data => data.name || data.title || data.company, {
    message: "At least one search parameter (name, title, or company) is required",
  }),
};

/**
 * Validate tool input against its schema.
 * Returns null if valid, or a clear error message if invalid.
 */
export function validateToolInput(toolName: string, input: any): string | null {
  const schema = schemas[toolName];
  if (!schema) return null; // No schema = no validation (pass through)

  const result = schema.safeParse(input);
  if (result.success) return null;

  // Build a clear error message from Zod issues
  const issues = result.error.issues.map(i => {
    const path = i.path.length > 0 ? `${i.path.join(".")}: ` : "";
    return `${path}${i.message}`;
  });
  return `Invalid parameters: ${issues.join("; ")}`;
}

// --- Post-response hallucination verification ---

// Patterns that indicate the AI claims to have performed an action
const ACTION_CLAIM_PATTERNS: Array<{ pattern: RegExp; tools: string[] }> = [
  { pattern: /I('ve|'ve| have) (sent|emailed|mailed)/i, tools: ["gmail_send"] },
  { pattern: /I('ve|'ve| have) (drafted|created a draft)/i, tools: ["gmail_create_draft", "gmail_send"] },
  { pattern: /I('ve|'ve| have) (posted|tweeted|shared).*(tweet|twitter|thread)/i, tools: ["twitter_post_tweet", "twitter_post_thread"] },
  { pattern: /I('ve|'ve| have) (posted|published|scheduled).*(buffer|linkedin|social)/i, tools: ["buffer_create_post"] },
  { pattern: /I('ve|'ve| have) (created|made).*(google doc|document)/i, tools: ["docs_create"] },
  { pattern: /I('ve|'ve| have) (created|sent).*(agreement|contract)/i, tools: ["agree_create_agreement", "agree_create_and_send", "agree_send_agreement"] },
  { pattern: /I('ve|'ve| have) (created|scheduled|set up).*(event)/i, tools: ["calendar_create_event", "luma_create_event"] },
  { pattern: /I('ve|'ve| have) (created|drafted).*(newsletter)/i, tools: ["beehiiv_create_draft"] },
];

/**
 * Check if the AI's response claims actions that weren't actually performed.
 * Returns null if no hallucination detected, or a warning message.
 */
export function checkActionClaims(
  responseText: string,
  toolCallLog: string[]
): string | null {
  for (const { pattern, tools } of ACTION_CLAIM_PATTERNS) {
    if (pattern.test(responseText)) {
      const anyCalled = tools.some(t => toolCallLog.includes(t));
      if (!anyCalled) {
        return `Warning: The AI claimed to have performed an action (matched: "${pattern.source}") but none of these tools were called: ${tools.join(", ")}. The action may not have actually happened.`;
      }
    }
  }
  return null;
}
