import type Anthropic from "@anthropic-ai/sdk";
import type { StoredContentBlock } from "@/models/Conversation";

const OMITTED_TOOL_RESULT = "(Non-text tool result omitted from chat history.)";
const MISSING_TOOL_RESULT = "(Tool result content was not retained.)";

function textFromToolResultContent(content: unknown[]): string | null {
  const text = content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string" &&
        block.text.length > 0,
    )
    .map((block) => block.text)
    .join("\n");

  return text.length > 0 ? text : null;
}

function toolResultContentForStorage(
  content: Anthropic.ToolResultBlockParam["content"],
): string {
  if (typeof content === "string" && content.length > 0) return content;
  if (Array.isArray(content)) {
    return textFromToolResultContent(content) ?? OMITTED_TOOL_RESULT;
  }
  return MISSING_TOOL_RESULT;
}

function storedToolResultContentForModel(content: unknown): string {
  if (typeof content === "string" && content.length > 0) return content;
  if (Array.isArray(content)) {
    return textFromToolResultContent(content) ?? OMITTED_TOOL_RESULT;
  }
  if (content !== undefined && content !== null) {
    try {
      const serialized = JSON.stringify(content);
      if (serialized) return serialized;
    } catch {
      // Fall through to a valid textual placeholder.
    }
  }
  return MISSING_TOOL_RESULT;
}

function sanitizeContentBlock(
  block: StoredContentBlock,
): Anthropic.ContentBlockParam | null {
  switch (block.type) {
    case "text":
      if (!block.text) return null;
      return { type: "text", text: block.text };
    case "tool_use":
      return {
        type: "tool_use",
        id: block.id ?? "",
        name: block.name ?? "",
        input: block.input ?? {},
      };
    case "server_tool_use":
      return {
        type: "server_tool_use",
        id: block.id ?? "",
        name: "web_search",
        input: block.input ?? {},
      };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.tool_use_id ?? "",
        content: storedToolResultContentForModel(block.content),
        ...(block.is_error ? { is_error: true } : {}),
      };
    case "web_search_tool_result":
      return {
        type: "web_search_tool_result",
        tool_use_id: block.tool_use_id ?? "",
        content:
          block.content as Anthropic.WebSearchToolResultBlockParam["content"],
      };
    case "image": {
      const url = block.source?.url;
      if (typeof url !== "string" || url.length === 0) return null;
      return {
        type: "image",
        source: { type: "url", url },
      };
    }
    case "document": {
      const url = block.source?.url;
      if (typeof url !== "string" || url.length === 0) return null;
      return {
        type: "document",
        source: { type: "url", url },
        ...(block.name ? { title: block.name } : {}),
      };
    }
    default:
      return null;
  }
}

export function sanitizeStoredMessageContent(
  content: string | StoredContentBlock[],
): string | Anthropic.ContentBlockParam[] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);
  const blocks = content
    .map((block) => sanitizeContentBlock(block))
    .filter((block): block is Anthropic.ContentBlockParam => block !== null);
  if (blocks.length === 0) return "(empty)";
  return blocks;
}

export function messageContentToStored(
  content: string | Anthropic.ContentBlockParam[],
): string | StoredContentBlock[] {
  if (typeof content === "string") return content;
  return content.map((block): StoredContentBlock => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "tool_use":
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      case "server_tool_use":
        return {
          type: "server_tool_use",
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      case "tool_result":
        return {
          type: "tool_result",
          tool_use_id: block.tool_use_id,
          content: toolResultContentForStorage(block.content),
          is_error: block.is_error ?? undefined,
        };
      case "web_search_tool_result":
        return {
          type: "web_search_tool_result",
          tool_use_id: block.tool_use_id,
          content: block.content,
        };
      case "image":
      case "document":
        return storedAttachmentBlock(block);
      default:
        return { type: block.type };
    }
  });
}

/**
 * Attachments previously fell through to the `default` case, which keeps only
 * the block type — the url was dropped on save, so a stored conversation had no
 * way back to the file it carried. Only url sources are persisted: base64
 * payloads would bloat the conversation document, and those bytes are inline in
 * the request rather than something we can point at later.
 */
function storedAttachmentBlock(
  block: Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam,
): StoredContentBlock {
  const stored: StoredContentBlock = { type: block.type };
  const name =
    "name" in block
      ? block.name
      : block.type === "document"
        ? block.title
        : undefined;
  if (typeof name === "string") stored.name = name;
  if (block.source.type === "url") {
    stored.source = { type: "url", url: block.source.url };
  }
  return stored;
}
