/**
 * Hybrid workflow executor for structured shortcuts.
 * Runs system steps deterministically, AI steps via callAnthropic,
 * and pause/prompt steps by saving state and waiting for user reply.
 */

import type { WorkflowStep, WorkflowState } from "../types/workflow";
import type { Task } from "../types/task";
import { getWorkflowState, upsertWorkflowState, deleteWorkflowState, getShortcut, type Shortcut } from "./db";
import { executeTool } from "./tools";
import { callAnthropic, getProvider, getApiKey, buildSystemPrompt } from "./ai";
import { getSetting } from "./db";
import { appendExecutionLog } from "./task";

// --- Variable Interpolation ---

function interpolate(template: string, context: Record<string, any>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const trimmed = path.trim();
    // Navigate dot paths: step.create_doc.result.url
    const parts = trimmed.split(".");
    let value: any = context;
    for (const part of parts) {
      if (value == null) return "";
      value = value[part];
    }
    if (value == null) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

function buildContext(
  stepResults: Record<string, any>,
  userInput: string,
  userReply?: string
): Record<string, any> {
  return {
    input: userInput,
    date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    step: stepResults,
    user_reply: userReply || "",
  };
}

// --- Step Execution ---

async function executeSystemStep(
  step: WorkflowStep & { type: "system" },
  context: Record<string, any>,
  taskId: string
): Promise<string> {
  const interpolatedInput: Record<string, any> = {};
  for (const [key, val] of Object.entries(step.input)) {
    interpolatedInput[key] = typeof val === "string" ? interpolate(val, context) : val;
  }

  console.log(`[workflow] System step "${step.id}": ${step.tool}`, JSON.stringify(interpolatedInput).slice(0, 200));
  const startTime = Date.now();
  const result = await executeTool(step.tool, interpolatedInput);
  const duration = Date.now() - startTime;

  appendExecutionLog(taskId, {
    tool: `workflow:${step.id}:${step.tool}`,
    input: interpolatedInput,
    output: result.slice(0, 2000),
    duration_ms: duration,
  });

  console.log(`[workflow] System step "${step.id}" completed in ${duration}ms`);
  return result;
}

async function executeAiStep(
  step: WorkflowStep & { type: "ai" },
  context: Record<string, any>,
  taskId: string
): Promise<string> {
  const prompt = interpolate(step.prompt, context);
  console.log(`[workflow] AI step "${step.id}": ${prompt.slice(0, 100)}...`);

  const model = getSetting("model") || "claude-sonnet-4-20250514";
  const provider = getProvider(model);
  const apiKey = getApiKey(provider);
  let systemPrompt = step.tools ? buildSystemPrompt() : "You are a helpful writing assistant. Respond with ONLY the requested content — no preamble, no explanations, no tool calls. Just the text.";
  const startTime = Date.now();

  // Single-turn AI call — focused prompt, no conversation history baggage
  const response = await callAnthropic(
    model,
    apiKey,
    systemPrompt,
    [{ role: "user", content: prompt }],
    0.7,
    8192
  );

  const duration = Date.now() - startTime;
  const result = response.content || "";

  appendExecutionLog(taskId, {
    tool: `workflow:${step.id}:ai`,
    input: { prompt: prompt.slice(0, 500) },
    output: result.slice(0, 2000),
    duration_ms: duration,
  });

  console.log(`[workflow] AI step "${step.id}" completed in ${duration}ms (${result.length} chars)`);
  return result;
}

// --- Main Executor ---

export interface WorkflowResult {
  response: string;
  status: "completed" | "paused" | "prompting" | "error";
}

export async function executeWorkflow(
  task: Task,
  shortcut: Shortcut,
  threadId: string,
  userInput: string,
  onStatus?: (msg: string) => void
): Promise<WorkflowResult> {
  const steps: WorkflowStep[] = JSON.parse(shortcut.workflow_steps || "[]");
  if (steps.length === 0) {
    return { response: "This shortcut has no workflow steps defined.", status: "error" };
  }

  // If no input provided, pause immediately and ask for it
  if (!userInput || !userInput.trim()) {
    upsertWorkflowState(threadId, {
      shortcut_id: shortcut.id,
      steps: shortcut.workflow_steps!,
      current_step: 0,
      step_results: "{}",
      user_input: "",
      status: "prompting",
    });
    const desc = shortcut.description || "run this workflow";
    return {
      response: `What would you like me to work with for "${shortcut.name}"? Please share an audio file, text, a URL, or any content to get started.`,
      status: "prompting",
    };
  }

  // Load or create workflow state
  let state = getWorkflowState(threadId);
  let stepResults: Record<string, any> = {};

  if (!state) {
    upsertWorkflowState(threadId, {
      shortcut_id: shortcut.id,
      steps: shortcut.workflow_steps!,
      current_step: 0,
      step_results: "{}",
      user_input: userInput,
      status: "running",
    });
    state = getWorkflowState(threadId)!;
  } else {
    stepResults = JSON.parse(state.step_results || "{}");
  }

  const startStep = state.current_step;
  let lastResponse = "";

  for (let i = startStep; i < steps.length; i++) {
    const step = steps[i];
    const context = buildContext(stepResults, state.user_input, stepResults.user_reply);

    onStatus?.(step.label || `Step ${i + 1}: ${step.type} — ${step.id}`);

    try {
      switch (step.type) {
        case "system": {
          const result = await executeSystemStep(step as any, context, task.task_id);
          // Try to parse JSON result for field access
          let parsed: any = result;
          try { parsed = JSON.parse(result); } catch {}
          stepResults[step.id] = { result: parsed };
          break;
        }

        case "ai": {
          const result = await executeAiStep(step as any, context, task.task_id);
          stepResults[step.id] = { result };
          break;
        }

        case "pause": {
          const message = interpolate(step.message, context);
          upsertWorkflowState(threadId, {
            shortcut_id: shortcut.id,
            current_step: i + 1,  // resume AFTER the pause
            step_results: JSON.stringify(stepResults),
            status: "paused",
          });
          console.log(`[workflow] Paused at step ${i} ("${step.id}") for thread ${threadId}`);
          return { response: message, status: "paused" };
        }

        case "prompt": {
          const message = interpolate(step.message, context);
          upsertWorkflowState(threadId, {
            shortcut_id: shortcut.id,
            current_step: i + 1,  // resume AFTER the prompt
            step_results: JSON.stringify(stepResults),
            status: "prompting",
          });
          console.log(`[workflow] Prompting user at step ${i} ("${step.id}") for thread ${threadId}`);
          return { response: message, status: "prompting" };
        }
      }

      // Save progress after each step
      upsertWorkflowState(threadId, {
        shortcut_id: shortcut.id,
        current_step: i + 1,
        step_results: JSON.stringify(stepResults),
        status: "running",
      });

      lastResponse = typeof stepResults[step.id]?.result === "string"
        ? stepResults[step.id].result
        : JSON.stringify(stepResults[step.id]?.result || "");

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[workflow] Error at step ${i} ("${step.id}"):`, errorMsg);

      appendExecutionLog(task.task_id, {
        tool: `workflow:${step.id}:error`,
        input: {},
        output: errorMsg,
        duration_ms: 0,
      });

      // Save error state — don't fail the whole workflow, ask the user
      upsertWorkflowState(threadId, {
        shortcut_id: shortcut.id,
        current_step: i,  // stay at failed step for retry
        step_results: JSON.stringify(stepResults),
        status: "error",
        error_step: i,
      });

      const stepLabel = step.label || step.id;
      const response = `Step ${i + 1} (${stepLabel}) failed: ${errorMsg}\n\nYou can:\n• Reply with info to help fix it and I'll retry\n• Say "skip" to move to the next step\n• Say "stop" to cancel the workflow`;
      return { response, status: "error" };
    }
  }

  // Workflow complete
  deleteWorkflowState(threadId);
  console.log(`[workflow] Completed all ${steps.length} steps for thread ${threadId}`);
  return { response: lastResponse || "Workflow completed.", status: "completed" };
}

/**
 * Resume a paused/prompting/errored workflow when the user replies.
 */
export async function resumeWorkflow(
  task: Task,
  threadId: string,
  userReply: string,
  onStatus?: (msg: string) => void
): Promise<WorkflowResult> {
  const state = getWorkflowState(threadId);
  if (!state) {
    return { response: "No active workflow found for this thread.", status: "error" };
  }

  const shortcut = getShortcut(state.shortcut_id);
  if (!shortcut) {
    deleteWorkflowState(threadId);
    return { response: "Shortcut no longer exists.", status: "error" };
  }

  const stepResults = JSON.parse(state.step_results || "{}");

  // Handle error recovery
  if (state.status === "error") {
    const reply = userReply.trim().toLowerCase();
    if (reply === "stop" || reply === "cancel") {
      deleteWorkflowState(threadId);
      return { response: "Workflow cancelled.", status: "completed" };
    }
    if (reply === "skip") {
      // Advance past the failed step
      upsertWorkflowState(threadId, {
        shortcut_id: shortcut.id,
        current_step: (state.error_step || state.current_step) + 1,
        step_results: JSON.stringify(stepResults),
        status: "running",
      });
    } else {
      // User provided info — save it and retry the failed step
      stepResults.user_reply = userReply;
      upsertWorkflowState(threadId, {
        shortcut_id: shortcut.id,
        step_results: JSON.stringify(stepResults),
        status: "running",
      });
    }
  } else {
    // Normal pause/prompt resume — save user reply
    stepResults.user_reply = userReply;
    // If user_input was empty (initial prompt for content), set it now
    const effectiveInput = state.user_input || userReply;
    upsertWorkflowState(threadId, {
      shortcut_id: shortcut.id,
      step_results: JSON.stringify(stepResults),
      user_input: effectiveInput,
      status: "running",
    });
  }

  // Reload state to get updated user_input
  const updatedState = getWorkflowState(threadId)!;
  return executeWorkflow(task, shortcut, threadId, updatedState.user_input, onStatus);
}
