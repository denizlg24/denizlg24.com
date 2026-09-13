import type { AgentUIMessage, AgentUIMessagePart } from "@repo/schemas";
import {
  type DynamicToolUIPart,
  isToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";

export function isAgentUIMessage(value: unknown): value is AgentUIMessage {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || !("role" in value) || !("parts" in value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    Array.isArray(value.parts)
  );
}

/**
 * Gateway response metadata occasionally contains null for an optional
 * boolean. BSON preserves that null, while the AI SDK prompt schema accepts
 * only boolean or absent. Normalize it at the persistence boundary so any
 * stored tool turn can be submitted again safely.
 */
export function normalizeAgentMessage(message: AgentUIMessage): AgentUIMessage {
  return {
    ...message,
    parts: message.parts.map((part): AgentUIMessagePart => {
      if (
        !isAgentToolPart(part) ||
        typeof part.providerExecuted === "boolean" ||
        part.providerExecuted === undefined
      ) {
        return part;
      }
      const { providerExecuted: _providerExecuted, ...normalized } = part;
      return normalized;
    }),
  };
}

export function messageText(message: Pick<UIMessage, "parts">): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

export type AgentToolPart = ToolUIPart | DynamicToolUIPart;

export function isAgentToolPart(
  part: AgentUIMessagePart,
): part is Extract<AgentUIMessagePart, AgentToolPart> {
  return isToolUIPart(part);
}

export function toolPartName(part: AgentToolPart): string {
  return part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
}

/** A tool output as plain text: connector results carry `content`, built-ins return JSON. */
export function toolOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (
    typeof output === "object" &&
    output !== null &&
    "content" in output &&
    Array.isArray(output.content)
  ) {
    return output.content
      .flatMap((part: unknown) =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("\n");
  }
  return output === undefined ? "" : JSON.stringify(output);
}
