import type { AgentUIMessage, AgentUIMessagePart } from "@repo/schemas";
import type {
  IConversationMessage,
  StoredContentBlock,
} from "@/models/Conversation";
import {
  isAgentToolPart,
  normalizeAgentMessage,
  toolOutputText,
} from "./messages";

const OMITTED_IMAGE = "[Image returned by the tool; not kept in history]";

function createdAtOf(message: AgentUIMessage): Date {
  const stamp = message.metadata?.createdAt;
  const parsed = stamp ? new Date(stamp) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(0);
}

function userBlocks(parts: AgentUIMessagePart[]): StoredContentBlock[] {
  const blocks: StoredContentBlock[] = [];
  for (const part of parts) {
    if (part.type === "text" && part.text) {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "file" && !part.url.startsWith("data:")) {
      blocks.push({
        type: part.mediaType === "application/pdf" ? "document" : "image",
        source: { type: "url", url: part.url },
        ...(part.filename ? { name: part.filename } : {}),
      });
    }
  }
  return blocks;
}

/**
 * The evidence pipeline reads the shape the Anthropic-SDK loop stored: one
 * row per message, tool results as their own user turn. A UI message is
 * mapped onto that shape part by part, with ids stable across saves — text
 * by position, tool results by call id — so re-saving a message never
 * re-observes what was already recorded.
 */
export function agentEvidenceUnits(
  messages: readonly AgentUIMessage[],
): IConversationMessage[] {
  const units: IConversationMessage[] = [];
  for (const message of messages) {
    const createdAt = createdAtOf(message);
    if (message.role === "user") {
      const content = userBlocks(message.parts);
      if (content.length > 0) {
        units.push({ eventId: message.id, role: "user", content, createdAt });
      }
      continue;
    }
    if (message.role !== "assistant") continue;
    message.parts.forEach((part, index) => {
      if (part.type === "text" && part.text.trim()) {
        units.push({
          eventId: `${message.id}:text:${index}`,
          role: "assistant",
          content: part.text,
          createdAt,
        });
        return;
      }
      if (
        isAgentToolPart(part) &&
        part.state === "output-available" &&
        !part.providerExecuted
      ) {
        units.push({
          eventId: `${message.id}:tool:${part.toolCallId}`,
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: part.toolCallId,
              content: toolOutputText(part.output),
            },
          ],
          createdAt,
        });
      }
    });
  }
  return units;
}

function withoutInlineImages(output: unknown): unknown {
  if (
    typeof output !== "object" ||
    output === null ||
    !("content" in output) ||
    !Array.isArray(output.content)
  ) {
    return output;
  }
  return {
    ...output,
    content: output.content.map((part: unknown) =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "image"
        ? { type: "text", text: OMITTED_IMAGE }
        : part,
    ),
  };
}

/**
 * Inline image bytes from a tool are for the step that asked for them; kept,
 * a few whiteboard renders would carry the document toward Mongo's size cap.
 */
export function sanitizeMessagesForStorage(
  messages: readonly AgentUIMessage[],
): AgentUIMessage[] {
  return messages.map((message) => {
    const normalized = normalizeAgentMessage(message);
    return {
      ...normalized,
      parts: normalized.parts.map((part) =>
        isAgentToolPart(part) && part.state === "output-available"
          ? { ...part, output: withoutInlineImages(part.output) }
          : part,
      ),
    };
  });
}
