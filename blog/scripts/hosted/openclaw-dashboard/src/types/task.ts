import crypto from "crypto";

// --- Status & Channel Types ---

export type TaskStatus =
  | "pending"
  | "processing"
  | "awaiting_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type ChannelType = "chat" | "slack" | "email";

// --- Task ID ---

export function generateTaskId(): string {
  return "tsk_" + crypto.randomBytes(6).toString("hex");
}

// --- Execution Log ---

export interface ExecutionLogEntry {
  tool: string;
  input: Record<string, unknown>;
  output: string;
  timestamp: string;
  duration_ms: number;
}

// --- Task Interface ---

export interface TaskInput {
  raw_input: string;
  source_channel: ChannelType;
  metadata?: Record<string, unknown>;
}

export interface TaskIntent {
  summary?: string;
  confidence?: number;
  classified_at?: string;
}

export interface TaskContext {
  conversation_id?: string;
  memory_refs?: string[];
}

export interface TaskOutput {
  reply_channel: ChannelType;
  format?: string;
  result?: string;
  error?: string;
}

export interface TaskExecution {
  model?: string;
  provider?: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  tool_calls_count?: number;
}

export interface Task {
  task_id: string;
  created_at: string;
  updated_at: string;
  status: TaskStatus;
  active: number;
  input: TaskInput;
  intent: TaskIntent;
  context: TaskContext;
  output: TaskOutput;
  execution: TaskExecution;
  conversation_id?: string;
}

// --- Create Params ---

export interface CreateTaskParams {
  raw_input: string;
  source_channel: ChannelType;
  reply_channel: ChannelType;
  metadata?: Record<string, unknown>;
  conversation_id?: string;
}
