import type {
  AgentLivePatch,
  AgentMessageMetadata,
  AgentUIMessage,
  AgentUIMessagePart,
} from "@repo/schemas";

/**
 * The arithmetic of following a turn that runs on the server: the server
 * diffs successive snapshots of the assistant message it is writing into
 * patches, and a client applies them to whatever copy it holds. A patch
 * replaces the parts from `start` on, so applying one twice, or applying the
 * full snapshot over a partial copy, lands on the same message.
 */

function samePart(a: AgentUIMessagePart, b: AgentUIMessagePart): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The parts of `next` from the first index that differs from `previous`.
 * A null `previous` (a new subscriber) gets everything from 0.
 */
export function diffMessageParts(
  previous: AgentUIMessage | null,
  next: AgentUIMessage,
): { start: number; parts: AgentUIMessagePart[] } | null {
  if (!previous || previous.id !== next.id) {
    return { start: 0, parts: next.parts };
  }
  const shared = Math.min(previous.parts.length, next.parts.length);
  let start = 0;
  while (start < shared) {
    const before = previous.parts[start];
    const after = next.parts[start];
    if (!before || !after || !samePart(before, after)) break;
    start += 1;
  }
  if (
    start === next.parts.length &&
    start === previous.parts.length &&
    JSON.stringify(previous.metadata ?? null) ===
      JSON.stringify(next.metadata ?? null)
  ) {
    return null;
  }
  return { start, parts: next.parts.slice(start) };
}

/**
 * Applies a patch to a message list. The message is found by id; a patch for
 * a message the list does not hold appends it, but only from a full snapshot
 * (`start` 0) — a tail without its head would draw half a reply.
 */
export function applyLivePatch(
  messages: readonly AgentUIMessage[],
  patch: Pick<AgentLivePatch, "messageId" | "start" | "parts" | "metadata">,
): AgentUIMessage[] {
  const index = messages.findIndex((message) => message.id === patch.messageId);
  if (index < 0) {
    if (patch.start !== 0) return [...messages];
    return [
      ...messages,
      {
        id: patch.messageId,
        role: "assistant",
        parts: patch.parts,
        ...(patch.metadata ? { metadata: patch.metadata } : {}),
      },
    ];
  }
  const current = messages[index];
  if (!current) return [...messages];
  const start = Math.min(patch.start, current.parts.length);
  const metadata: AgentMessageMetadata | undefined = patch.metadata
    ? { ...current.metadata, ...patch.metadata }
    : current.metadata;
  const next: AgentUIMessage = {
    ...current,
    parts: [...current.parts.slice(0, start), ...patch.parts],
    ...(metadata ? { metadata } : {}),
  };
  return [...messages.slice(0, index), next, ...messages.slice(index + 1)];
}

/** Tracks the last applied `seq` per turn so a replayed or late patch is dropped. */
export function createPatchGate() {
  let turnId: string | null = null;
  let seq = -1;
  return {
    accept(patch: Pick<AgentLivePatch, "turnId" | "seq">): boolean {
      if (patch.turnId !== turnId) {
        turnId = patch.turnId;
        seq = patch.seq;
        return true;
      }
      if (patch.seq <= seq) return false;
      seq = patch.seq;
      return true;
    },
    reset() {
      turnId = null;
      seq = -1;
    },
  };
}

export const INTERRUPTED_TOOL_TEXT = "Interrupted before it finished";

function isToolLike(
  part: AgentUIMessagePart,
): part is Extract<AgentUIMessagePart, { toolCallId: string }> {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

/**
 * A message as a stopped turn leaves it: streaming text settles, and a tool
 * call that never got its result ends as an error, so the stored thread has
 * nothing left waiting and the next message can be sent. A call waiting on an
 * approval is left alone — that is a finished step, not an interrupted one.
 */
export function interruptMessage(message: AgentUIMessage): AgentUIMessage {
  const parts = message.parts.map((part): AgentUIMessagePart => {
    if (
      (part.type === "text" || part.type === "reasoning") &&
      part.state === "streaming"
    ) {
      return { ...part, state: "done" };
    }
    if (!isToolLike(part)) return part;
    if (part.state === "input-streaming" || part.state === "input-available") {
      const { approval: _approval, ...rest } = part as typeof part & {
        approval?: unknown;
      };
      return {
        ...rest,
        state: "output-error",
        input: part.input ?? {},
        errorText: INTERRUPTED_TOOL_TEXT,
      } as AgentUIMessagePart;
    }
    if (part.state === "approval-responded") {
      return {
        ...part,
        state: "output-error",
        errorText: INTERRUPTED_TOOL_TEXT,
      } as AgentUIMessagePart;
    }
    return part;
  });
  return {
    ...message,
    parts,
    metadata: { ...message.metadata, interrupted: true },
  };
}

/** Replaces the message with the same id, or appends it. */
export function upsertMessage(
  messages: readonly AgentUIMessage[],
  message: AgentUIMessage,
): AgentUIMessage[] {
  const index = messages.findIndex((entry) => entry.id === message.id);
  if (index < 0) return [...messages, message];
  return [...messages.slice(0, index), message, ...messages.slice(index + 1)];
}

/**
 * Server-Sent Events as they arrive in arbitrary chunks: complete `data:`
 * payloads come out, comments and partial lines wait.
 */
export function createSseParser(onData: (data: string) => void) {
  let buffer = "";
  let data: string[] = [];
  return (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line === "") {
        if (data.length > 0) onData(data.join("\n"));
        data = [];
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).replace(/^ /, ""));
      }
      newline = buffer.indexOf("\n");
    }
  };
}
