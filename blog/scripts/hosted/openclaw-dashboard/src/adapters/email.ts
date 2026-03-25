import type { Task } from "../types/task";
import { createTask } from "../services/task";
import {
  getOrCreateConversation,
  deleteConversation,
  getSetting,
  getEmailThreadState,
  upsertEmailThreadState,
  getStaleAwaitingReplyThreads,
  markGmailThreadProcessed,
  type EmailThreadStateRow,
} from "../services/db";
import {
  gmailCreateDraft,
  gmailSend,
  getGoogleAccounts,
} from "../services/google";
import { getProvider, getApiKey } from "../services/ai";

// --- Types ---

export interface TriageResult {
  classification: "request" | "not_a_request" | "unclear" | "needs_info";
  confidence: number;
  reasoning: string;
  request_summary?: string;
  clarifying_question?: string;
  delivery_channel?: "email" | "slack" | "google_docs";
  delivery_details?: Record<string, string>;
  thread_context_summary: string;
}

export interface StructuredRequest {
  request: string;
  context: string;
  thread_participants: string[];
  original_sender: string;
  thread_subject: string;
  delivery: {
    channel: "email" | "slack" | "google_docs";
    details: Record<string, string>;
  };
  account_id: string;
}

export interface EmailThreadContext {
  threadId: string;
  accountId: string;
  subject: string;
  latestMessageId: string;
  latestSender: string;
  allRecipients: string;
  messageIdHeader: string;
  threadMessages: Array<{
    from: string;
    body: string;
    timestamp: string;
    messageId: string;
  }>;
  ownEmail: string;
  replyMode: "draft" | "send";
}

const MAX_CLARIFICATIONS = 3;
const MAX_THREAD_MESSAGES = 10;
const MAX_MESSAGE_BODY_LENGTH = 5000;

// --- Triage AI System Prompt ---

const TRIAGE_SYSTEM_PROMPT = `You are an email triage assistant. Your job is to analyze an email thread and determine:

1. Is this email asking the agent (the email account owner's AI assistant) to DO something? (a "request")
2. If yes, what exactly is the request?
3. If unclear, what clarifying question should be asked?
4. Where should the response be delivered?

CLASSIFICATION RULES:
- "request": The email clearly asks the agent to take an action, answer a question, create something, research something, or perform a task. Examples: "Can you draft a blog post about X?", "Please send the report to the team", "What's the status of project Y?", "Schedule a meeting for next week"
- "not_a_request": The email is informational only — newsletters, FYI messages, automated notifications, confirmations, receipts, marketing, social media notifications, calendar invites with no action needed, or messages where the sender is clearly not expecting the AI assistant to do anything. Also: messages that are responses/acknowledgments like "Thanks!", "Got it", "Looks good", "Sounds great", or simple agreements.
- "unclear": You cannot determine if this is a request or not. The email is ambiguous — it could be either informational or a request. When in doubt, classify as "unclear" and ask a brief, friendly clarifying question.
- "needs_info": This IS a request, but critical details are missing that are needed to fulfill it. For example: "Post this to Slack" but which channel? "Create a doc" but what should be in it?

DELIVERY CHANNEL DETECTION:
- Default delivery is always "email" (reply in the email thread)
- If the sender explicitly says "post this in Slack", "send to Slack channel #X", set delivery_channel to "slack" and include channel info in delivery_details
- If the sender says "put this in a Google Doc", "create a doc", set delivery_channel to "google_docs" and include any title hints in delivery_details
- Only override email delivery if EXPLICITLY requested by the sender

OUTPUT FORMAT:
You MUST respond with valid JSON only. No markdown, no code fences, no explanation, no preamble. Just the raw JSON object.

{
  "classification": "request" | "not_a_request" | "unclear" | "needs_info",
  "confidence": <number between 0.0 and 1.0>,
  "reasoning": "<brief explanation of your classification>",
  "request_summary": "<clear, actionable summary of what the agent should do — REQUIRED when classification is 'request' or 'needs_info', omit otherwise>",
  "clarifying_question": "<a brief, friendly question to ask the sender — REQUIRED when classification is 'unclear' or 'needs_info', omit otherwise>",
  "delivery_channel": "email" | "slack" | "google_docs",
  "delivery_details": {},
  "thread_context_summary": "<2-3 sentence summary of the full thread context>"
}`;

// --- Main Entry Point ---

export async function processIncomingEmail(ctx: EmailThreadContext): Promise<void> {
  const { threadId, accountId, latestMessageId } = ctx;

  try {
    const existingState = getEmailThreadState(threadId, accountId);

    // Skip if already in-flight
    if (existingState) {
      if (existingState.state === "triaging" || existingState.state === "processing") {
        console.log(`[email-adapter] Thread ${threadId} already in state '${existingState.state}', skipping`);
        return;
      }

      // If awaiting reply, check if there's a new message
      if (existingState.state === "awaiting_reply") {
        if (existingState.latest_message_id === latestMessageId) {
          // No new message — still waiting
          return;
        }
        // New message arrived — re-triage
        console.log(`[email-adapter] Reply received in thread ${threadId}, re-triaging`);
        upsertEmailThreadState(threadId, accountId, {
          state: "triaging",
          latest_message_id: latestMessageId,
          latest_sender: ctx.latestSender,
          all_recipients: ctx.allRecipients,
          message_id_header: ctx.messageIdHeader,
          reply_mode: ctx.replyMode,
        });
      }

      // If delivered/dismissed/not_a_request with same message, skip
      if (
        (existingState.state === "delivered" ||
          existingState.state === "dismissed" ||
          existingState.state === "not_a_request" ||
          existingState.state === "failed") &&
        existingState.latest_message_id === latestMessageId
      ) {
        return;
      }

      // If delivered/dismissed/failed but NEW message, start fresh triage
      if (
        existingState.state === "delivered" ||
        existingState.state === "dismissed" ||
        existingState.state === "not_a_request" ||
        existingState.state === "failed"
      ) {
        console.log(`[email-adapter] New message in previously processed thread ${threadId}, re-triaging`);
        upsertEmailThreadState(threadId, accountId, {
          state: "triaging",
          latest_message_id: latestMessageId,
          latest_sender: ctx.latestSender,
          all_recipients: ctx.allRecipients,
          message_id_header: ctx.messageIdHeader,
          thread_subject: ctx.subject,
          triage_result: "{}",
          structured_request: "{}",
          clarification_count: 0,
          task_id: null,
          reply_mode: ctx.replyMode,
        });
      }
    } else {
      // New thread — create initial state
      upsertEmailThreadState(threadId, accountId, {
        state: "triaging",
        latest_message_id: latestMessageId,
        latest_sender: ctx.latestSender,
        all_recipients: ctx.allRecipients,
        message_id_header: ctx.messageIdHeader,
        thread_subject: ctx.subject,
        delivery_channel: "email",
        reply_mode: ctx.replyMode,
      });
    }

    // Run triage
    const currentState = getEmailThreadState(threadId, accountId);
    const triageResult = await triageEmail(ctx, currentState || undefined);

    console.log(`[email-adapter] Triage result for thread ${threadId}: ${triageResult.classification} (confidence: ${triageResult.confidence})`);

    // Store triage result and reply mode
    upsertEmailThreadState(threadId, accountId, {
      triage_result: JSON.stringify(triageResult),
      reply_mode: ctx.replyMode,
    });

    const replyMode = ctx.replyMode;

    switch (triageResult.classification) {
      case "not_a_request": {
        upsertEmailThreadState(threadId, accountId, {
          state: "not_a_request",
        });
        markGmailThreadProcessed(threadId, latestMessageId, accountId);
        console.log(`[email-adapter] Thread ${threadId} classified as not a request — dismissed`);
        break;
      }

      case "request": {
        // Build structured request and create task
        const structured = buildStructuredRequest(ctx, triageResult);
        upsertEmailThreadState(threadId, accountId, {
          state: "processing",
          structured_request: JSON.stringify(structured),
          delivery_channel: structured.delivery.channel,
        });
        const task = createEmailTask(ctx, structured);
        upsertEmailThreadState(threadId, accountId, {
          task_id: task.task_id,
        });
        console.log(`[email-adapter] Task ${task.task_id} created for thread ${threadId}: ${triageResult.request_summary}`);
        break;
      }

      case "unclear":
      case "needs_info": {
        const clarificationCount = currentState?.clarification_count || 0;
        if (clarificationCount >= MAX_CLARIFICATIONS) {
          upsertEmailThreadState(threadId, accountId, {
            state: "dismissed",
          });
          markGmailThreadProcessed(threadId, latestMessageId, accountId);
          console.log(`[email-adapter] Thread ${threadId} dismissed after ${MAX_CLARIFICATIONS} clarification attempts`);

          // Send final message
          await sendClarification(
            ctx,
            "I've tried to understand your request but I'm still not sure what you need. Could you send a new email with a clear, specific request? Thanks!",
            replyMode
          );
          break;
        }

        const question =
          triageResult.clarifying_question ||
          "I received your email but I'm not sure if there's something specific you'd like me to help with. Is this a request you'd like me to handle?";

        await sendClarification(ctx, question, replyMode);
        upsertEmailThreadState(threadId, accountId, {
          state: "awaiting_reply",
          clarification_count: clarificationCount + 1,
        });
        markGmailThreadProcessed(threadId, latestMessageId, accountId);
        console.log(`[email-adapter] Clarification sent for thread ${threadId} (attempt ${clarificationCount + 1}/${MAX_CLARIFICATIONS})`);
        break;
      }
    }
  } catch (err: unknown) {
    console.error(
      `[email-adapter] Error processing thread ${threadId}:`,
      err instanceof Error ? err.message : err
    );
    upsertEmailThreadState(threadId, accountId, {
      state: "failed",
    });
  }
}

// --- Stage 1: Triage AI Call ---

async function triageEmail(
  ctx: EmailThreadContext,
  existingState?: EmailThreadStateRow
): Promise<TriageResult> {
  const threadContext = buildThreadContext(ctx);

  // Build previous triage context if re-triaging
  let previousContext = "";
  if (existingState && existingState.triage_result !== "{}") {
    try {
      const prev = JSON.parse(existingState.triage_result) as TriageResult;
      if (prev.clarifying_question) {
        previousContext = `\n\nPREVIOUS TRIAGE CONTEXT:
My previous classification was: ${prev.classification}
I asked the following clarification: "${prev.clarifying_question}"
The latest message(s) above include their response to that clarification.
Please re-evaluate with this additional context. If they confirmed it IS a request, classify as "request". If they said "no" or "never mind", classify as "not_a_request".`;
      }
    } catch {}
  }

  const userMessage = `EMAIL THREAD (newest first):
Thread ID: ${ctx.threadId}
Subject: ${ctx.subject}
Account: ${ctx.ownEmail}

${threadContext}${previousContext}`;

  // Call the triage AI
  const model = getSetting("model") || "claude-sonnet-4-20250514";
  const provider = getProvider(model);
  const apiKey = getApiKey(provider);

  const response = await callTriageAI(provider, apiKey, model, userMessage);

  // Parse JSON response
  try {
    return parseTriageResponse(response);
  } catch {
    // Retry once with explicit instruction
    console.warn(`[email-adapter] Triage response was not valid JSON, retrying...`);
    const retryMessage = `${userMessage}\n\nIMPORTANT: Your previous response was not valid JSON. You MUST respond with ONLY a raw JSON object, no markdown, no code fences, no explanation.`;
    const retryResponse = await callTriageAI(provider, apiKey, model, retryMessage);
    try {
      return parseTriageResponse(retryResponse);
    } catch {
      // Default to "unclear" with generic question
      console.error(`[email-adapter] Triage JSON parse failed twice, defaulting to 'unclear'`);
      return {
        classification: "unclear",
        confidence: 0.3,
        reasoning: "Failed to parse AI triage response",
        clarifying_question:
          "I received your email but had trouble understanding the request. Could you rephrase what you'd like me to do?",
        thread_context_summary: `Email thread with subject "${ctx.subject}"`,
      };
    }
  }
}

function parseTriageResponse(response: string): TriageResult {
  // Strip markdown code fences if present
  let cleaned = response.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  const parsed = JSON.parse(cleaned);

  // Validate required fields
  if (
    !parsed.classification ||
    !["request", "not_a_request", "unclear", "needs_info"].includes(parsed.classification)
  ) {
    throw new Error(`Invalid classification: ${parsed.classification}`);
  }

  return {
    classification: parsed.classification,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    reasoning: parsed.reasoning || "",
    request_summary: parsed.request_summary,
    clarifying_question: parsed.clarifying_question,
    delivery_channel: parsed.delivery_channel || "email",
    delivery_details: parsed.delivery_details || {},
    thread_context_summary: parsed.thread_context_summary || "",
  };
}

async function callTriageAI(
  provider: "anthropic" | "openai",
  apiKey: string,
  model: string,
  userMessage: string
): Promise<string> {
  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0.3,
        system: TRIAGE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic triage API error (${res.status}): ${body}`);
    }
    const data: any = await res.json();
    return (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  } else {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0.3,
        messages: [
          { role: "system", content: TRIAGE_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI triage API error (${res.status}): ${body}`);
    }
    const data: any = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }
}

// --- Thread Context Builder ---

function buildThreadContext(ctx: EmailThreadContext): string {
  const messages = ctx.threadMessages.slice(-MAX_THREAD_MESSAGES);
  // Reverse so newest is first
  const reversed = [...messages].reverse();

  return reversed
    .map((msg, i) => {
      let body = msg.body;
      if (body.length > MAX_MESSAGE_BODY_LENGTH) {
        body = body.slice(0, MAX_MESSAGE_BODY_LENGTH) + "\n[... truncated ...]";
      }
      return `--- Message ${i + 1} of ${reversed.length}${i === 0 ? " (latest)" : ""} ---
From: ${msg.from}
Date: ${msg.timestamp}

${body}`;
    })
    .join("\n\n");
}

// --- Build Structured Request ---

function buildStructuredRequest(
  ctx: EmailThreadContext,
  triageResult: TriageResult
): StructuredRequest {
  const allParticipants = new Set<string>();
  for (const msg of ctx.threadMessages) {
    const email = extractEmail(msg.from);
    if (email) allParticipants.add(email);
  }
  // Add recipients from allRecipients
  for (const addr of ctx.allRecipients.split(",").map((s) => s.trim()).filter(Boolean)) {
    const email = extractEmail(addr);
    if (email) allParticipants.add(email);
  }
  // Remove own email
  allParticipants.delete(ctx.ownEmail.toLowerCase());

  const replySubject = ctx.subject.startsWith("Re:") ? ctx.subject : `Re: ${ctx.subject}`;
  const ownEmail = ctx.ownEmail.toLowerCase();

  // Build reply-all recipients
  const ccList = [...allParticipants]
    .filter((e) => e !== extractEmail(ctx.latestSender))
    .join(", ");

  return {
    request: triageResult.request_summary || "Process this email request",
    context: triageResult.thread_context_summary || "",
    thread_participants: [...allParticipants],
    original_sender: ctx.latestSender,
    thread_subject: ctx.subject,
    delivery: {
      channel: triageResult.delivery_channel || "email",
      details: {
        to: ctx.latestSender,
        cc: ccList,
        thread_id: ctx.threadId,
        in_reply_to: ctx.messageIdHeader,
        subject: replySubject,
        ...(triageResult.delivery_details || {}),
      },
    },
    account_id: ctx.accountId,
  };
}

// --- Clarification Email ---

async function sendClarification(
  ctx: EmailThreadContext,
  question: string,
  replyMode: "draft" | "send"
): Promise<void> {
  const replySubject = ctx.subject.startsWith("Re:") ? ctx.subject : `Re: ${ctx.subject}`;
  const ownEmail = ctx.ownEmail.toLowerCase();

  // Reply-all: to = latest sender, cc = everyone else minus own
  const allAddrs = ctx.allRecipients
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ccList = allAddrs
    .filter((addr) => {
      const email = extractEmail(addr);
      return email !== ownEmail && email !== extractEmail(ctx.latestSender);
    })
    .join(", ") || undefined;

  const accounts = getGoogleAccounts();
  const account = accounts.find((a) => a.email === ctx.accountId);
  const canSend = account?.services.includes("gmail_send");

  if (replyMode === "send" && canSend) {
    const result = JSON.parse(
      await gmailSend(
        ctx.latestSender,
        replySubject,
        question,
        ctx.accountId,
        undefined,
        ccList,
        ctx.threadId,
        ctx.messageIdHeader
      )
    );
    if (result.error) {
      console.error(`[email-adapter] Failed to send clarification: ${result.error}`);
    } else {
      console.log(`[email-adapter] Sent clarification to ${ctx.latestSender}`);
    }
  } else {
    const result = JSON.parse(
      await gmailCreateDraft(
        ctx.latestSender,
        replySubject,
        question,
        ctx.accountId,
        undefined,
        ccList,
        ctx.threadId,
        ctx.messageIdHeader
      )
    );
    if (result.error) {
      console.error(`[email-adapter] Failed to create clarification draft: ${result.error}`);
    } else {
      console.log(`[email-adapter] Created clarification draft for ${ctx.latestSender}`);
    }
  }
}

// --- Task Creation (Stage 2 handoff) ---

function createEmailTask(
  ctx: EmailThreadContext,
  structuredRequest: StructuredRequest
): Task {
  // Clear old conversation history for fresh processing
  const conversationId = getOrCreateConversation("gmail", ctx.threadId);
  try {
    deleteConversation(conversationId);
  } catch {}
  const freshConversationId = getOrCreateConversation("gmail", ctx.threadId);

  // Build extra context for the central AI
  const deliveryInstructions =
    structuredRequest.delivery.channel === "google_docs"
      ? "Write your response as a well-structured document with headings and sections. It will be saved to a Google Doc."
      : structuredRequest.delivery.channel === "slack"
        ? "Write your response as a Slack message using Slack formatting. It will be posted to Slack."
        : "Write your response as a professional email reply body. Start with a greeting.";

  const extraContext = `You are processing an email request from ${structuredRequest.original_sender}.

THREAD CONTEXT: ${structuredRequest.context}

THREAD SUBJECT: ${structuredRequest.thread_subject}
THREAD PARTICIPANTS: ${structuredRequest.thread_participants.join(", ")}

INSTRUCTIONS:
- Fulfill the request described in the user message below.
- Your response will be delivered via ${structuredRequest.delivery.channel}.
- ${deliveryInstructions}
- You have access to all your tools. Use them as needed to fulfill the request.
- Do NOT send any emails yourself — your output text will be delivered automatically.
- Do NOT create Gmail drafts — the system will handle delivery.`;

  const task = createTask({
    raw_input: structuredRequest.request,
    source_channel: "email",
    reply_channel: "email",
    metadata: {
      threadId: ctx.threadId,
      accountId: ctx.accountId,
      subject: ctx.subject,
      latestSender: ctx.latestSender,
      allRecipients: ctx.allRecipients,
      messageIdHeader: ctx.messageIdHeader,
      latestMessageId: ctx.latestMessageId,
      delivery: structuredRequest.delivery,
      context: extraContext,
    },
    conversation_id: freshConversationId,
  });

  return task;
}

// --- Output Delivery (called by router) ---

export async function onEmailTaskComplete(task: Task): Promise<void> {
  const metadata = task.input.metadata || {};
  const threadId = metadata.threadId as string;
  const accountId = metadata.accountId as string;
  const latestMessageId = metadata.latestMessageId as string;
  const delivery = metadata.delivery as StructuredRequest["delivery"] | undefined;

  if (!threadId || !accountId) {
    console.error(`[email-adapter] Task ${task.task_id} missing threadId/accountId in metadata`);
    return;
  }

  // Use reply mode stored in thread state (persisted at triage time)
  const threadState = getEmailThreadState(threadId, accountId);
  const replyMode = (threadState?.reply_mode as "draft" | "send") || "draft";
  const accounts = getGoogleAccounts();
  const account = accounts.find((a) => a.email === accountId);
  const canSend = account?.services.includes("gmail_send");

  try {
    if (task.status === "failed") {
      // Send error notification
      const errorMsg = "Sorry, I ran into an error processing your request. Please try again or rephrase your request.";
      await sendEmailReply(
        metadata as Record<string, string>,
        errorMsg,
        replyMode,
        canSend || false
      );
      upsertEmailThreadState(threadId, accountId, { state: "failed" });
      if (latestMessageId) markGmailThreadProcessed(threadId, latestMessageId, accountId);
      console.log(`[email-adapter] Task ${task.task_id} failed, error notification sent`);
      return;
    }

    const result = task.output.result || "";
    const channel = delivery?.channel || "email";

    if (channel === "slack") {
      // Deliver to Slack
      try {
        const { sendSlackMessage, isSlackRunning } = require("../services/slack");
        const slackChannel = delivery?.details?.slack_channel;
        if (isSlackRunning() && slackChannel) {
          await sendSlackMessage(slackChannel, result);
          // Send brief email notification
          await sendEmailReply(
            metadata as Record<string, string>,
            `I've posted the response in Slack. Let me know if you need anything else!`,
            replyMode,
            canSend || false
          );
          console.log(`[email-adapter] Task ${task.task_id} delivered to Slack channel ${slackChannel}`);
        } else {
          // Fallback to email
          console.warn(`[email-adapter] Slack not available, falling back to email delivery`);
          await sendEmailReply(
            metadata as Record<string, string>,
            `You asked me to post this in Slack, but Slack is not connected. Here's the response via email instead:\n\n${result}`,
            replyMode,
            canSend || false
          );
        }
      } catch (err: unknown) {
        console.error(`[email-adapter] Slack delivery failed, falling back to email:`, err instanceof Error ? err.message : err);
        await sendEmailReply(
          metadata as Record<string, string>,
          result,
          replyMode,
          canSend || false
        );
      }
    } else if (channel === "google_docs") {
      // Deliver to Google Docs
      try {
        const { docsCreate } = require("../services/google");
        const docTitle = delivery?.details?.doc_title || `Email Request: ${metadata.subject || "Untitled"}`;
        const docResult = JSON.parse(await docsCreate(docTitle, result, accountId));
        if (docResult.error) throw new Error(docResult.error);
        const docUrl = docResult.url || `https://docs.google.com/document/d/${docResult.id}`;
        await sendEmailReply(
          metadata as Record<string, string>,
          `I've created a Google Doc with the response: ${docUrl}\n\nLet me know if you need any changes!`,
          replyMode,
          canSend || false
        );
        console.log(`[email-adapter] Task ${task.task_id} delivered to Google Doc: ${docUrl}`);
      } catch (err: unknown) {
        console.error(`[email-adapter] Google Docs delivery failed, falling back to email:`, err instanceof Error ? err.message : err);
        await sendEmailReply(
          metadata as Record<string, string>,
          result,
          replyMode,
          canSend || false
        );
      }
    } else {
      // Default: email delivery
      await sendEmailReply(
        metadata as Record<string, string>,
        result,
        replyMode,
        canSend || false
      );
      console.log(`[email-adapter] Task ${task.task_id} delivered via email`);
    }

    upsertEmailThreadState(threadId, accountId, { state: "delivered" });
    if (latestMessageId) markGmailThreadProcessed(threadId, latestMessageId, accountId);
  } catch (err: unknown) {
    console.error(
      `[email-adapter] Failed to deliver task ${task.task_id}:`,
      err instanceof Error ? err.message : err
    );
    upsertEmailThreadState(threadId, accountId, { state: "failed" });
  }
}

// --- Helper: Send email reply ---

async function sendEmailReply(
  metadata: Record<string, string>,
  body: string,
  replyMode: "draft" | "send",
  canSend: boolean
): Promise<void> {
  const to = metadata.latestSender;
  const subject = (metadata.subject || "").startsWith("Re:")
    ? metadata.subject
    : `Re: ${metadata.subject || ""}`;
  const accountId = metadata.accountId;
  const threadId = metadata.threadId;
  const inReplyTo = metadata.messageIdHeader;

  // Build CC from allRecipients minus own email and to-address
  const ownEmail = accountId?.toLowerCase();
  const toEmail = extractEmail(to);
  const cc =
    (metadata.allRecipients || "")
      .split(",")
      .map((s) => s.trim())
      .filter((addr) => {
        const email = extractEmail(addr);
        return email !== ownEmail && email !== toEmail;
      })
      .join(", ") || undefined;

  if (replyMode === "send" && canSend) {
    await gmailSend(to, subject, body, accountId, undefined, cc, threadId, inReplyTo);
  } else {
    await gmailCreateDraft(to, subject, body, accountId, undefined, cc, threadId, inReplyTo);
  }
}

// --- Helper: Extract email from "Name <email>" ---

function extractEmail(from: string): string {
  const match = from.toLowerCase().trim().match(/<([^>]+)>/);
  return match ? match[1] : from.toLowerCase().trim();
}

// --- Stale Thread Cleanup ---

export function cleanupStaleThreads(): void {
  const stale = getStaleAwaitingReplyThreads(24);
  for (const thread of stale) {
    upsertEmailThreadState(thread.thread_id, thread.account_id, {
      state: "dismissed",
    });
    console.log(`[email-adapter] Dismissed stale awaiting_reply thread ${thread.thread_id}`);
  }
  if (stale.length > 0) {
    console.log(`[email-adapter] Cleaned up ${stale.length} stale thread(s)`);
  }
}
