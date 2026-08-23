import type { AgentMemoryMode, AgentTaskOrigin } from "@repo/schemas";

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
  /** Machine-readable bounds, so a range stated in prose is also enforceable. */
  minimum?: number;
  maximum?: number;
  format?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, ToolParameter | Record<string, unknown>>;
    required?: string[];
  };
}

/**
 * Which entry point drove the current turn. The distinction that matters is
 * whether anyone is present: a chat turn can ask a question and wait, a cron
 * firing cannot, and an agent-scheduled run had nobody in the loop at all.
 */
export type AgentRunSurface =
  | "user-chat"
  | "user-voice"
  | "background-agent"
  | "scheduled-task"
  | "one-off-task"
  | "manual-task-run";

export interface AgentRunTaskContext {
  id: string;
  runId: string;
  name: string;
  /** Who queued the task. An agent-scheduled run had nobody in the loop. */
  origin: AgentTaskOrigin;
  cron?: string;
  timeZone?: string;
  runAt?: string;
}

export interface AgentRunContext {
  surface: AgentRunSurface;
  /** No one is waiting on this turn; nothing can be asked and then answered. */
  unattended: boolean;
  executionMode: "interactive" | "yolo";
  /** Desktop-page tools only exist when a client is attached to the stream. */
  clientToolsAvailable: boolean;
  task?: AgentRunTaskContext;
}

/** Per-turn state a tool may need that is not part of the model's input. */
export interface ToolExecutionContext {
  conversationId?: string;
  /**
   * Memory mode of the surrounding turn. Tools that write to agent memory must
   * honour it: an incognito turn records nothing, whatever the model asks for.
   */
  memoryMode?: AgentMemoryMode;
  /** Where this turn is running. Absent only for callers that predate it. */
  run?: AgentRunContext;
}

export interface ToolDefinition {
  schema: ToolSchema;
  isWrite: boolean;
  category: string;
  runtime?: "server" | "client";
  execute?: (
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ) => Promise<unknown>;
}

/** Returned from execute() to attach an image block to the tool result.
 *  The summary is what streams to the client UI and accompanies the image
 *  as text for the model. */
export interface ToolImageResult {
  kind: "tool-image";
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  base64: string;
  summary: Record<string, unknown>;
}

export function isToolImageResult(value: unknown): value is ToolImageResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "tool-image" &&
    "base64" in value &&
    typeof value.base64 === "string" &&
    "mediaType" in value &&
    typeof value.mediaType === "string"
  );
}
