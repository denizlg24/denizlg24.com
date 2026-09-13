import type {
  AgentMessageMetadata,
  AgentUIMessage,
  AgentUIMessagePart,
} from "@repo/schemas";
import type {
  IConversationMessage,
  StoredContentBlock,
} from "@/models/Conversation";

const NOT_COMPLETED = "Not completed before the conversation was migrated";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredBlock(value: unknown): value is StoredContentBlock {
  return isRecord(value) && typeof value.type === "string";
}

function blocksOf(message: IConversationMessage): StoredContentBlock[] {
  if (typeof message.content === "string") {
    return message.content ? [{ type: "text", text: message.content }] : [];
  }
  return Array.isArray(message.content)
    ? message.content.filter(isStoredBlock)
    : [];
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((entry) =>
        isRecord(entry) && typeof entry.text === "string" ? entry.text : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return content === undefined || content === null
    ? ""
    : JSON.stringify(content);
}

function mediaTypeFor(block: StoredContentBlock, url: string): string {
  if (block.type === "document") return "application/pdf";
  const extension = url.split("?")[0]?.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "image/jpeg";
}

function userParts(blocks: StoredContentBlock[]): AgentUIMessagePart[] {
  const parts: AgentUIMessagePart[] = [];
  for (const block of blocks) {
    if (block.type === "text" && block.text) {
      parts.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "image" || block.type === "document") {
      const url = block.source?.url;
      if (typeof url !== "string" || !url) continue;
      parts.push({
        type: "file",
        mediaType: mediaTypeFor(block, url),
        url,
        ...(block.name ? { filename: block.name } : {}),
      });
    }
  }
  return parts;
}

function sourceParts(block: StoredContentBlock): AgentUIMessagePart[] {
  if (!Array.isArray(block.content)) return [];
  const parts: AgentUIMessagePart[] = [];
  for (const entry of block.content) {
    if (!isRecord(entry) || typeof entry.url !== "string") continue;
    parts.push({
      type: "source-url",
      sourceId: entry.url,
      url: entry.url,
      ...(typeof entry.title === "string" ? { title: entry.title } : {}),
    });
  }
  return parts;
}

function metadataOf(message: IConversationMessage): AgentMessageMetadata {
  return {
    createdAt: new Date(message.createdAt).toISOString(),
    ...(message.tokenUsage
      ? {
          usage: {
            inputTokens: message.tokenUsage.inputTokens,
            outputTokens: message.tokenUsage.outputTokens,
            costUsd: message.tokenUsage.costUsd,
          },
        }
      : {}),
    ...(message.retrievalTraceId
      ? { retrievalTraceId: message.retrievalTraceId }
      : {}),
    ...(message.memoryInjected !== undefined
      ? { memoryInjected: message.memoryInjected }
      : {}),
  };
}

function isToolResultTurn(blocks: StoredContentBlock[]): boolean {
  return (
    blocks.length > 0 && blocks.every((block) => block.type === "tool_result")
  );
}

/**
 * Converts a thread stored by the Anthropic-SDK loop. Tool-result user turns
 * are folded into the assistant message that asked for them — one UI message
 * spans every step of a response — and message ids keep the stored event ids
 * so evidence already recorded under them is recognised, not re-observed.
 */
export function legacyToUIMessages(
  stored: readonly IConversationMessage[],
): AgentUIMessage[] {
  const messages: AgentUIMessage[] = [];
  let assistant: AgentUIMessage | null = null;

  const settle = () => {
    if (!assistant) return;
    assistant.parts = assistant.parts.map((part) =>
      part.type === "dynamic-tool" &&
      (part.state === "input-available" || part.state === "input-streaming")
        ? {
            type: "dynamic-tool",
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            state: "output-error",
            input: part.input,
            errorText: NOT_COMPLETED,
          }
        : part,
    );
    messages.push(assistant);
    assistant = null;
  };

  for (const message of stored) {
    const blocks = blocksOf(message);

    if (message.role === "user") {
      if (assistant && isToolResultTurn(blocks)) {
        for (const block of blocks) {
          const toolCallId = block.tool_use_id;
          const current: AgentUIMessage = assistant;
          current.parts = current.parts.map((part) => {
            if (
              part.type !== "dynamic-tool" ||
              part.toolCallId !== toolCallId
            ) {
              return part;
            }
            const text = toolResultText(block.content);
            return block.is_error
              ? {
                  type: "dynamic-tool",
                  toolName: part.toolName,
                  toolCallId: part.toolCallId,
                  state: "output-error",
                  input: part.input,
                  errorText: text || "The tool reported an error",
                }
              : {
                  type: "dynamic-tool",
                  toolName: part.toolName,
                  toolCallId: part.toolCallId,
                  state: "output-available",
                  input: part.input,
                  output: { content: [{ type: "text", text }] },
                };
          });
        }
        continue;
      }
      settle();
      const parts = userParts(blocks);
      if (parts.length === 0) continue;
      messages.push({
        id: message.eventId,
        role: "user",
        parts,
        metadata: metadataOf(message),
      });
      continue;
    }

    const parts: AgentUIMessagePart[] = [];
    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        parts.push({ type: "text", text: block.text, state: "done" });
      } else if (block.type === "tool_use" && block.id && block.name) {
        parts.push({
          type: "dynamic-tool",
          toolName: block.name,
          toolCallId: block.id,
          state: "input-available",
          input: block.input ?? {},
        });
      } else if (block.type === "web_search_tool_result") {
        parts.push(...sourceParts(block));
      }
    }

    if (assistant) {
      const current: AgentUIMessage = assistant;
      current.parts.push({ type: "step-start" }, ...parts);
      current.metadata = {
        ...current.metadata,
        ...metadataOf(message),
        createdAt: current.metadata?.createdAt,
      };
    } else {
      assistant = {
        id: message.eventId,
        role: "assistant",
        parts: [{ type: "step-start" }, ...parts],
        metadata: metadataOf(message),
      };
    }
  }
  settle();
  return messages;
}

export function isLegacyConversation(format: string | undefined): boolean {
  return format !== "ui";
}
