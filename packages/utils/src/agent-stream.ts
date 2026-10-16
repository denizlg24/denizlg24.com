import {
  type AgentUIMessage,
  type AgentUIMessagePart,
  getToolLabel,
} from "@repo/schemas";

/**
 * The agent's UI message stream (`createUIMessageStreamResponse` on the
 * server), read without the AI SDK's client: Server-Sent Events whose `data`
 * is one chunk each, ending in `[DONE]`. The iPhone apps read it with this
 * instead of `readUIMessageStream`, which needs web streams React Native does
 * not have.
 *
 * What it builds is for drawing a turn as it arrives. Answering an approval
 * is done against the stored conversation, never against this copy: the
 * server only accepts decisions for the approval ids it holds.
 */

export type AgentToolPart = Extract<AgentUIMessagePart, { toolCallId: string }>;

export function isToolPart(part: AgentUIMessagePart): part is AgentToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

export function toolPartName(part: AgentToolPart): string {
  return part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
}

export interface AgentTurn {
  message: AgentUIMessage;
  finished: boolean;
  error: string | null;
}

export function emptyTurn(id = ""): AgentTurn {
  return {
    message: { id, role: "assistant", parts: [] },
    finished: false,
    error: null,
  };
}

type Record_ = Record<string, unknown>;

function text(chunk: Record_, key: string): string {
  const value = chunk[key];
  return typeof value === "string" ? value : "";
}

function withParts(turn: AgentTurn, parts: AgentUIMessagePart[]): AgentTurn {
  return { ...turn, message: { ...turn.message, parts } };
}

type ToolState =
  | { state: "input-streaming"; input: unknown }
  | { state: "input-available"; input: unknown }
  | { state: "approval-requested"; input: unknown; approval: { id: string } }
  | { state: "output-available"; input: unknown; output: unknown }
  | { state: "output-error"; input: unknown; errorText: string }
  | {
      state: "output-denied";
      input: unknown;
      approval: { id: string; approved: false };
    };

interface ToolIdentity {
  toolName: string;
  toolCallId: string;
  providerExecuted: boolean;
  dynamic: boolean;
}

function identityOf(part: AgentToolPart): ToolIdentity {
  return {
    toolName: toolPartName(part),
    toolCallId: part.toolCallId,
    providerExecuted: part.providerExecuted === true,
    dynamic: part.type === "dynamic-tool",
  };
}

function makeTool(identity: ToolIdentity, state: ToolState): AgentToolPart {
  const { toolName, toolCallId, providerExecuted } = identity;
  if (identity.dynamic) {
    return {
      type: "dynamic-tool",
      toolName,
      toolCallId,
      providerExecuted,
      ...state,
    };
  }
  return { type: `tool-${toolName}`, toolCallId, providerExecuted, ...state };
}

function updateTool(
  turn: AgentTurn,
  toolCallId: string,
  next: (part: AgentToolPart) => ToolState | null,
): AgentTurn {
  const parts = turn.message.parts.map((part) => {
    if (!isToolPart(part) || part.toolCallId !== toolCallId) return part;
    const state = next(part);
    return state ? makeTool(identityOf(part), state) : part;
  });
  return withParts(turn, parts);
}

function identityFromChunk(chunk: Record_): ToolIdentity {
  return {
    toolName: text(chunk, "toolName"),
    toolCallId: text(chunk, "toolCallId"),
    providerExecuted: chunk.providerExecuted === true,
    dynamic: chunk.dynamic === true,
  };
}

function lastIndex<T>(items: readonly T[], test: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && test(item)) return index;
  }
  return -1;
}

function appendText(
  turn: AgentTurn,
  kind: "text" | "reasoning",
  delta: string,
): AgentTurn {
  const parts = [...turn.message.parts];
  const last = parts.at(-1);
  if (last?.type === kind) {
    parts[parts.length - 1] = { ...last, text: last.text + delta };
  } else {
    parts.push({ type: kind, text: delta, state: "streaming" });
  }
  return withParts(turn, parts);
}

function closeText(turn: AgentTurn, kind: "text" | "reasoning"): AgentTurn {
  const parts = [...turn.message.parts];
  const index = lastIndex(parts, (part) => part.type === kind);
  const target = parts[index];
  if (target?.type === kind) parts[index] = { ...target, state: "done" };
  return withParts(turn, parts);
}

export function applyChunk(turn: AgentTurn, chunk: unknown): AgentTurn {
  if (!chunk || typeof chunk !== "object") return turn;
  const record = chunk as Record_;
  const type = text(record, "type");
  switch (type) {
    case "start": {
      const id = text(record, "messageId");
      return id ? { ...turn, message: { ...turn.message, id } } : turn;
    }
    case "start-step":
      return withParts(turn, [...turn.message.parts, { type: "step-start" }]);
    case "text-start":
      return withParts(turn, [
        ...turn.message.parts,
        { type: "text", text: "", state: "streaming" },
      ]);
    case "text-delta":
      return appendText(turn, "text", text(record, "delta"));
    case "text-end":
      return closeText(turn, "text");
    case "reasoning-start":
      return withParts(turn, [
        ...turn.message.parts,
        { type: "reasoning", text: "", state: "streaming" },
      ]);
    case "reasoning-delta":
      return appendText(turn, "reasoning", text(record, "delta"));
    case "reasoning-end":
      return closeText(turn, "reasoning");
    case "tool-input-start":
      return withParts(turn, [
        ...turn.message.parts,
        makeTool(identityFromChunk(record), {
          state: "input-streaming",
          input: undefined,
        }),
      ]);
    case "tool-input-available": {
      const identity = identityFromChunk(record);
      const fresh = makeTool(identity, {
        state: "input-available",
        input: record.input,
      });
      const exists = turn.message.parts.some(
        (part) => isToolPart(part) && part.toolCallId === identity.toolCallId,
      );
      if (!exists) return withParts(turn, [...turn.message.parts, fresh]);
      return updateTool(turn, identity.toolCallId, () => ({
        state: "input-available",
        input: record.input,
      }));
    }
    case "tool-approval-request":
      return updateTool(turn, text(record, "toolCallId"), (part) =>
        part.state === "input-available" || part.state === "input-streaming"
          ? {
              state: "approval-requested",
              input: part.input,
              approval: { id: text(record, "approvalId") },
            }
          : null,
      );
    case "tool-output-available":
      return updateTool(turn, text(record, "toolCallId"), (part) => ({
        state: "output-available",
        input: part.input,
        output: record.output,
      }));
    case "tool-output-error":
    case "tool-input-error":
      return updateTool(turn, text(record, "toolCallId"), (part) => ({
        state: "output-error",
        input: part.input,
        errorText: text(record, "errorText") || "The tool failed",
      }));
    case "tool-output-denied":
      return updateTool(turn, text(record, "toolCallId"), (part) =>
        part.state === "approval-requested" ||
        part.state === "approval-responded"
          ? {
              state: "output-denied",
              input: part.input,
              approval: { id: part.approval.id, approved: false },
            }
          : null,
      );
    case "source-url":
      return withParts(turn, [
        ...turn.message.parts,
        {
          type: "source-url",
          sourceId: text(record, "sourceId"),
          url: text(record, "url"),
          ...(text(record, "title") ? { title: text(record, "title") } : {}),
        },
      ]);
    case "file":
      return withParts(turn, [
        ...turn.message.parts,
        {
          type: "file",
          url: text(record, "url"),
          mediaType: text(record, "mediaType"),
        },
      ]);
    case "data-notice": {
      const data = record.data;
      if (!data || typeof data !== "object") return turn;
      const notice = data as Record_;
      return withParts(turn, [
        ...turn.message.parts,
        {
          type: "data-notice",
          data: {
            level: notice.level === "warning" ? "warning" : "info",
            text: text(notice, "text"),
          },
        },
      ]);
    }
    case "error":
      return {
        ...turn,
        error: text(record, "errorText") || "The turn failed",
      };
    case "finish":
    case "abort":
      return { ...turn, finished: true };
    default:
      return turn;
  }
}

/** The label of a tool whose result has not landed yet, for a ticker. */
export function runningTool(message: Pick<AgentUIMessage, "parts">) {
  const last = message.parts.at(-1);
  if (!last || !isToolPart(last)) return null;
  return last.state === "input-streaming" || last.state === "input-available"
    ? getToolLabel(toolPartName(last))
    : null;
}

/** Everything said, for a transcript. */
export function messageText(message: Pick<AgentUIMessage, "parts">): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();
}

/** The words after the last tool call: the reply, without the progress notes. */
export function replyText(message: Pick<AgentUIMessage, "parts">): string {
  const lastTool = lastIndex(message.parts, isToolPart);
  return message.parts
    .slice(lastTool + 1)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();
}

/** Tool calls in the last step still waiting on a yes or no. */
export function pendingApprovals(
  message: Pick<AgentUIMessage, "parts" | "role">,
): Extract<AgentToolPart, { state: "approval-requested" }>[] {
  if (message.role !== "assistant") return [];
  const lastStep = lastIndex(
    message.parts,
    (part) => part.type === "step-start",
  );
  return message.parts
    .slice(lastStep + 1)
    .filter(isToolPart)
    .filter(
      (part): part is Extract<AgentToolPart, { state: "approval-requested" }> =>
        part.state === "approval-requested" && !part.approval.isAutomatic,
    );
}

/**
 * The assistant message that answers approvals: the stored message's id, and
 * each answered call as `approval-responded`. The server copies only these
 * decisions onto its own copy.
 */
export function approvalReply(
  stored: AgentUIMessage,
  decisions: ReadonlyMap<string, boolean>,
): AgentUIMessage {
  const parts: AgentUIMessagePart[] = [];
  for (const part of pendingApprovals(stored)) {
    const approved = decisions.get(part.approval.id);
    if (approved === undefined) continue;
    parts.push({
      ...part,
      state: "approval-responded",
      approval: { ...part.approval, approved },
    });
  }
  return { id: stored.id, role: "assistant", parts };
}

/**
 * Splits arriving bytes into SSE events. Feed decoded text; get back each
 * complete event's `data`, `[DONE]` excluded.
 */
export function createEventParser() {
  let buffer = "";
  return (chunk: string): unknown[] => {
    buffer += chunk.replace(/\r\n/g, "\n");
    const events: unknown[] = [];
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data && data !== "[DONE]") {
        try {
          events.push(JSON.parse(data));
        } catch {
          // A malformed event is skipped, not fatal: the rest still reads.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
    return events;
  };
}
