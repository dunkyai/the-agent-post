import {
  type Task,
  type TaskStatus,
  type CreateTaskParams,
  type ExecutionLogEntry,
} from "../types/task";
import {
  insertTask as dbInsertTask,
  getTask as dbGetTask,
  updateTask as dbUpdateTask,
  getPendingTasks as dbGetPendingTasks,
  getRecentTasks as dbGetRecentTasks,
  appendExecutionLog as dbAppendLog,
  getExecutionLog as dbGetLog,
  deactivateOldTasks as dbDeactivate,
  markStuckTasksFailed as dbMarkStuck,
} from "./db";

function deserializeTask(row: any): Task {
  return {
    task_id: row.task_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status: row.status as TaskStatus,
    active: row.active,
    input: JSON.parse(row.input || "{}"),
    intent: JSON.parse(row.intent || "{}"),
    context: JSON.parse(row.context || "{}"),
    output: JSON.parse(row.output || "{}"),
    execution: JSON.parse(row.execution || "{}"),
    conversation_id: row.conversation_id || undefined,
  };
}

export function createTask(params: CreateTaskParams): Task {
  const taskId = dbInsertTask(params);
  return getTaskById(taskId)!;
}

export function getTaskById(taskId: string): Task | undefined {
  const row = dbGetTask(taskId);
  if (!row) return undefined;
  return deserializeTask(row);
}

export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  updates?: {
    intent?: string;
    context?: string;
    output?: string;
    execution?: string;
    conversation_id?: string;
  }
): void {
  dbUpdateTask(taskId, { status, ...updates });
}

export function appendExecutionLog(
  taskId: string,
  entry: Omit<ExecutionLogEntry, "timestamp">
): void {
  dbAppendLog(taskId, entry);
}

export function getTaskExecutionLog(taskId: string): ExecutionLogEntry[] {
  const rows = dbGetLog(taskId);
  return rows.map((r) => ({
    tool: r.tool,
    input: JSON.parse(r.input || "{}"),
    output: r.output,
    timestamp: r.created_at,
    duration_ms: r.duration_ms,
  }));
}

export function getPendingTasks(): Task[] {
  return dbGetPendingTasks().map(deserializeTask);
}

export function getRecentTasks(limit = 50): Task[] {
  return dbGetRecentTasks(limit).map(deserializeTask);
}

export function deactivateOldTasks(days: number): number {
  return dbDeactivate(days);
}

export function markStuckTasksFailed(): number {
  return dbMarkStuck();
}
