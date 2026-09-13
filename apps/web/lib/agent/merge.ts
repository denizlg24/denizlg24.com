import {
  type AgentUIMessage,
  type AgentUIMessagePart,
  isAgentPageTool,
} from "@repo/schemas";
import { isAgentToolPart, toolPartName } from "./messages";

const MAX_USER_TEXT = 64_000;
const MAX_ATTACHMENTS = 8;

export class AgentMergeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AgentMergeError";
  }
}

/**
 * A user message from the client keeps only what a user can send: text and
 * file references. Data parts, tool parts or anything else are dropped.
 */
export function sanitizeUserMessage(message: AgentUIMessage): AgentUIMessage {
  const parts: AgentUIMessagePart[] = [];
  let files = 0;
  for (const part of message.parts) {
    if (part.type === "text") {
      const text = part.text.slice(0, MAX_USER_TEXT);
      if (text.trim()) parts.push({ type: "text", text });
    } else if (part.type === "file" && files < MAX_ATTACHMENTS) {
      if (!/^(https?:|data:)/.test(part.url)) continue;
      files += 1;
      parts.push({
        type: "file",
        mediaType: part.mediaType,
        url: part.url,
        ...(part.filename ? { filename: part.filename } : {}),
      });
    }
  }
  if (parts.length === 0) {
    throw new AgentMergeError("A message needs text or an attachment", 400);
  }
  return {
    id: message.id,
    role: "user",
    parts,
    metadata: {
      createdAt: new Date().toISOString(),
      ...(message.metadata?.page ? { page: message.metadata.page } : {}),
    },
  };
}

function isPageTool(part: AgentUIMessagePart): boolean {
  return isAgentToolPart(part) && isAgentPageTool(toolPartName(part));
}

/** True while the last assistant message still waits on Deniz or the client. */
export function hasPendingWork(messages: readonly AgentUIMessage[]): boolean {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return false;
  return last.parts.some(
    (part) =>
      isAgentToolPart(part) &&
      (part.state === "approval-requested" ||
        (part.state === "input-available" && isPageTool(part))),
  );
}

/**
 * Applies what the client is allowed to decide on the stored assistant
 * message: an answer to each approval it was asked for, and the output of
 * each page tool it was asked to run. Everything else on the incoming copy —
 * text, other tool outputs, metadata — is ignored.
 */
export function applyClientDecisions(
  stored: readonly AgentUIMessage[],
  incoming: AgentUIMessage,
): AgentUIMessage[] {
  const last = stored.at(-1);
  if (last?.role !== "assistant" || last.id !== incoming.id) {
    throw new AgentMergeError(
      "The conversation is not waiting on that message",
      409,
    );
  }
  const byCall = new Map<string, AgentUIMessagePart>();
  for (const part of incoming.parts) {
    if (isAgentToolPart(part)) byCall.set(part.toolCallId, part);
  }

  let changed = false;
  let alreadyApplied = false;
  let lastStepStart = -1;
  last.parts.forEach((part, index) => {
    if (part.type === "step-start") lastStepStart = index;
  });
  const parts = last.parts.map((part, index): AgentUIMessagePart => {
    if (!isAgentToolPart(part)) return part;
    const answer = byCall.get(part.toolCallId);
    if (!answer || !isAgentToolPart(answer)) return part;

    if (
      part.state === "approval-requested" &&
      answer.state === "approval-responded" &&
      answer.approval.id === part.approval.id
    ) {
      changed = true;
      return {
        ...part,
        state: "approval-responded",
        approval: {
          ...part.approval,
          approved: answer.approval.approved,
          ...(answer.approval.reason
            ? { reason: answer.approval.reason.slice(0, 2_000) }
            : {}),
        },
      };
    }

    if (
      index > lastStepStart &&
      part.state === "approval-responded" &&
      answer.state === "approval-responded" &&
      answer.approval.id === part.approval.id
    ) {
      alreadyApplied = true;
      return part;
    }

    if (part.state === "input-available" && isPageTool(part)) {
      if (answer.state === "output-available") {
        changed = true;
        return { ...part, state: "output-available", output: answer.output };
      }
      if (answer.state === "output-error") {
        changed = true;
        return {
          ...part,
          state: "output-error",
          errorText: answer.errorText.slice(0, 4_000),
        };
      }
    }
    if (
      index > lastStepStart &&
      isPageTool(part) &&
      (part.state === "output-available" || part.state === "output-error") &&
      answer.state === part.state
    ) {
      alreadyApplied = true;
    }
    return part;
  });

  if (!changed && !alreadyApplied) {
    throw new AgentMergeError("Nothing to continue from", 400);
  }
  return [...stored.slice(0, -1), { ...last, parts }];
}

/** History up to, and excluding, the assistant message being regenerated. */
export function truncateForRegenerate(
  stored: readonly AgentUIMessage[],
  messageId: string,
): AgentUIMessage[] {
  const index = stored.findIndex(
    (message) => message.id === messageId && message.role === "assistant",
  );
  if (index < 0) {
    throw new AgentMergeError("That message is not in the conversation", 404);
  }
  return stored.slice(0, index);
}
