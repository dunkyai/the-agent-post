export interface SystemStep {
  type: "system";
  id: string;
  tool: string;
  input: Record<string, string>;
  label?: string;
}

export interface AiStep {
  type: "ai";
  id: string;
  prompt: string;
  label?: string;
}

export interface PauseStep {
  type: "pause";
  id: string;
  message: string;
  label?: string;
}

export interface PromptStep {
  type: "prompt";
  id: string;
  message: string;  // question to ask the user
  label?: string;
}

export type WorkflowStep = SystemStep | AiStep | PauseStep | PromptStep;

export interface WorkflowState {
  thread_id: string;
  shortcut_id: number;
  steps: string;           // JSON of WorkflowStep[]
  current_step: number;
  step_results: string;    // JSON of Record<string, any>
  user_input: string;      // original user input (transcription, text, etc.)
  status: "running" | "paused" | "prompting" | "error" | "completed" | "cancelled";
  error_step?: number;     // step index that failed (for retry)
  created_at: string;
  updated_at: string;
}
