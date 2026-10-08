import { getToolLabel } from "@repo/schemas";

/**
 * The agent's UI message stream (`createUIMessageStreamResponse` on the
 * server), read without the AI SDK's client: Server-Sent Events whose `data`
 * is one chunk each, ending in `[DONE]`. A voice turn needs three things from
 * it — the tool at work, the text so far, and the reply to speak, which is
 * the text after the last tool call (`spokenReplyText` on the web).
 */

type Part =
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; name: string };

export interface TurnState {
  parts: Part[];
  /** The label of a tool still running, for the ticker. */
  runningTool: string | null;
  finished: boolean;
  error: string | null;
}

export const emptyTurn: TurnState = {
  parts: [],
  runningTool: null,
  finished: false,
  error: null,
};

function field(chunk: Record<string, unknown>, key: string): string {
  const value = chunk[key];
  return typeof value === "string" ? value : "";
}

export function applyChunk(state: TurnState, chunk: unknown): TurnState {
  if (!chunk || typeof chunk !== "object") return state;
  const record = chunk as Record<string, unknown>;
  switch (record.type) {
    case "text-start":
      return {
        ...state,
        runningTool: null,
        parts: [
          ...state.parts,
          { kind: "text", id: field(record, "id"), text: "" },
        ],
      };
    case "text-delta": {
      const id = field(record, "id");
      const delta = field(record, "delta");
      const parts = [...state.parts];
      const index = parts.findLastIndex(
        (part) => part.kind === "text" && part.id === id,
      );
      const target = parts[index];
      if (target?.kind === "text") {
        parts[index] = { ...target, text: target.text + delta };
      } else {
        parts.push({ kind: "text", id, text: delta });
      }
      return { ...state, parts };
    }
    case "tool-input-start":
      return {
        ...state,
        runningTool: getToolLabel(field(record, "toolName")),
        parts: [
          ...state.parts,
          { kind: "tool", name: field(record, "toolName") },
        ],
      };
    case "tool-output-available":
    case "tool-output-error":
    case "tool-output-denied":
      return { ...state, runningTool: null };
    case "error":
      return {
        ...state,
        error: field(record, "errorText") || "The turn failed",
      };
    case "finish":
    case "abort":
      return { ...state, finished: true, runningTool: null };
    default:
      return state;
  }
}

/** Everything said, for the transcript. */
export function fullText(state: TurnState): string {
  return state.parts
    .flatMap((part) => (part.kind === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();
}

/** What gets spoken: the text after the last tool call. */
export function spokenText(state: TurnState): string {
  const lastTool = state.parts.findLastIndex((part) => part.kind === "tool");
  return state.parts
    .slice(lastTool + 1)
    .flatMap((part) => (part.kind === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();
}

/**
 * Splits arriving bytes into SSE events. Feed decoded text; get back each
 * complete event's `data`, `[DONE]` excluded.
 */
export function createEventParser() {
  let buffer = "";
  return (text: string): unknown[] => {
    buffer += text.replace(/\r\n/g, "\n");
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
