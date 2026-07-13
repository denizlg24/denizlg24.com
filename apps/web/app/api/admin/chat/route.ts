import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { AgentMemoryMode } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { retrieveMemoriesShadow } from "@/lib/agent-memory/retrieval";
import {
  getConversation,
  updateConversationMessages,
} from "@/lib/conversations";
import { hasPendingToolContinuation } from "@/lib/llm-chat";
import {
  CatalogUnavailableError,
  LlmConfigurationError,
  LlmModelError,
} from "@/lib/llm-errors";
import { streamAgent } from "@/lib/llm-service";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireAdmin } from "@/lib/require-admin";
import { getAppTimeZone } from "@/lib/timezone";
import { getToolSchemas } from "@/lib/tools/registry";
import { buildSystemPrompt } from "@/lib/tools/system-prompt";
import type {
  IConversationMessage,
  StoredContentBlock,
  TokenUsage,
} from "@/models/Conversation";

export const maxDuration = 300;

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
    case "tool_result": {
      const result: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: block.tool_use_id ?? "",
      };
      if (block.content !== undefined) {
        result.content =
          block.content as Anthropic.ToolResultBlockParam["content"];
      }
      if (block.is_error) {
        result.is_error = true;
      }
      return result;
    }
    case "web_search_tool_result":
      return {
        type: "web_search_tool_result",
        tool_use_id: block.tool_use_id ?? "",
        content:
          block.content as Anthropic.WebSearchToolResultBlockParam["content"],
      };
    default:
      return null;
  }
}

function sanitizeContent(
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

function messageContentToStored(
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
          content:
            typeof block.content === "string" ? block.content : undefined,
          is_error: block.is_error ?? undefined,
        };
      case "web_search_tool_result":
        return {
          type: "web_search_tool_result",
          tool_use_id: block.tool_use_id,
          content: block.content,
        };
      default:
        return { type: block.type };
    }
  });
}

function messageTextForRetrieval(message: unknown): string {
  if (typeof message === "string") return message;
  if (!Array.isArray(message)) return "";
  return message
    .filter(
      (block): block is { type: "text"; text: string } =>
        !!block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

export const POST = async (req: NextRequest) => {
  const adminError = await requireAdmin(req);
  if (adminError) return adminError;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed, remaining, resetMs } = await checkRateLimit(`chat:${ip}`, {
    maxRequests: 10,
  });

  if (!allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(resetMs / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  try {
    const {
      conversationId,
      message,
      model = "anthropic/claude-sonnet-4.6",
      toolsEnabled = true,
      webSearchEnabled = false,
      toolApprovals,
      clientToolResults,
    } = await req.json();

    const hasMessage = !!message;
    const hasContinuation = !!toolApprovals || !!clientToolResults;

    if (hasMessage && hasContinuation) {
      return NextResponse.json(
        {
          error:
            "message cannot be combined with toolApprovals or clientToolResults",
        },
        { status: 400 },
      );
    }
    if (!hasMessage && !hasContinuation) {
      return NextResponse.json(
        {
          error:
            "Either message, toolApprovals, or clientToolResults is required",
        },
        { status: 400 },
      );
    }
    if (hasContinuation && !conversationId) {
      return NextResponse.json(
        { error: "conversationId is required for continuations" },
        { status: 400 },
      );
    }

    const messages: Anthropic.MessageParam[] = [];
    const existingTokenUsage = new Map<number, TokenUsage>();
    const existingEventIds = new Map<number, string>();
    const existingCreatedAt = new Map<number, Date>();
    let memoryMode: AgentMemoryMode = "enabled";

    if (conversationId) {
      const conversation = await getConversation(conversationId);
      if (conversation) {
        memoryMode = conversation.memoryMode;
        for (const msg of conversation.messages) {
          const index = messages.length;
          messages.push({
            role: msg.role,
            content: sanitizeContent(msg.content),
          });
          if (msg.tokenUsage) {
            existingTokenUsage.set(index, msg.tokenUsage);
          }
          if (msg.eventId) existingEventIds.set(index, msg.eventId);
          existingCreatedAt.set(index, msg.createdAt);
        }
      }
    }

    if (message) {
      if (hasPendingToolContinuation(messages)) {
        return NextResponse.json(
          {
            error: "Resolve the pending tool call before sending a new message",
          },
          { status: 409 },
        );
      }
      const userContent: string | Anthropic.ContentBlockParam[] =
        typeof message === "string" ? message : message;
      messages.push({ role: "user", content: userContent });
    }

    const tools: Anthropic.ToolUnion[] = [];
    if (toolsEnabled) {
      const schemas = getToolSchemas();
      for (const schema of schemas) {
        tools.push({
          name: schema.name,
          description: schema.description,
          input_schema: schema.input_schema,
        });
      }
    }

    if (webSearchEnabled) {
      const webSearchTool: Anthropic.WebSearchTool20250305 = {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 5,
      };
      tools.push(webSearchTool);
    }

    const system = buildSystemPrompt(await getAppTimeZone());

    if (message) {
      try {
        await retrieveMemoriesShadow({
          conversationId,
          requestId: randomUUID(),
          query: messageTextForRetrieval(message),
          memoryMode,
        });
      } catch (error) {
        console.error("Agent memory shadow retrieval failed", {
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    const onPersist = async (
      msgs: Anthropic.MessageParam[],
      tokenUsage?: TokenUsage,
    ) => {
      if (!conversationId) return;

      const messagesToStore: IConversationMessage[] = msgs.map((m, i) => {
        const preserved = existingTokenUsage.get(i);
        const isLastAssistant = i === msgs.length - 1 && m.role === "assistant";

        return {
          eventId: existingEventIds.get(i) ?? randomUUID(),
          role:
            m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: messageContentToStored(m.content),
          ...(isLastAssistant && tokenUsage
            ? { tokenUsage }
            : preserved
              ? { tokenUsage: preserved }
              : {}),
          createdAt: existingCreatedAt.get(i) ?? new Date(),
        };
      });

      await updateConversationMessages(conversationId, messagesToStore);
    };

    // Capability validation happens inside the service before any upstream
    // stream opens; incompatible models are rejected as plain HTTP errors.
    const sseStream = await streamAgent({
      purpose: "chat",
      source: "dashboard-chat",
      system,
      messages,
      model,
      tools: tools.length > 0 ? tools : undefined,
      toolApprovals,
      clientToolResults,
      onPersist,
      requireTools: toolsEnabled,
      requireWebSearch: webSearchEnabled,
    });

    return new Response(sseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-RateLimit-Remaining": String(remaining),
      },
    });
  } catch (error) {
    if (error instanceof LlmModelError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof CatalogUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof LlmConfigurationError) {
      return NextResponse.json(
        { error: "LLM service is not configured" },
        { status: 500 },
      );
    }
    console.error("Chat route error:", error);
    return NextResponse.json(
      { error: "Failed to process chat request" },
      { status: 500 },
    );
  }
};
