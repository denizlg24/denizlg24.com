import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import {
  type AgentMemoryMode,
  backgroundAgentPageContextSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { injectMemoryImages } from "@/lib/agent-memory/message-images";
import {
  buildRetrievalQuery,
  updateConversationRetrievalSummary,
} from "@/lib/agent-memory/query-context";
import {
  type ChatMemoryRetrievalResult,
  loadInjectedMemoryContext,
  loadInjectedMemoryImages,
  retrieveMemoriesForChat,
} from "@/lib/agent-memory/retrieval";
import {
  getConversation,
  updateConversationMessages,
} from "@/lib/conversations";
import { clampMaxIterations, hasPendingToolContinuation } from "@/lib/llm-chat";
import {
  CatalogUnavailableError,
  LlmConfigurationError,
  LlmModelError,
} from "@/lib/llm-errors";
import {
  messageContentToStored,
  sanitizeStoredMessageContent,
} from "@/lib/llm-message-storage";
import { streamAgent } from "@/lib/llm-service";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireAdmin } from "@/lib/require-admin";
import { getAppTimeZone } from "@/lib/timezone";
import { getToolSchemas } from "@/lib/tools/registry";
import { buildSystemPrompt } from "@/lib/tools/system-prompt";
import type { IConversationMessage, TokenUsage } from "@/models/Conversation";

export const maxDuration = 300;

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
      executionMode: requestedExecutionMode,
      maxRounds,
      pageContext,
    } = await req.json();

    const executionMode =
      requestedExecutionMode === "yolo" ? "yolo" : "interactive";
    const parsedPageContext =
      pageContext !== undefined
        ? backgroundAgentPageContextSchema.safeParse(pageContext)
        : null;
    if (parsedPageContext && !parsedPageContext.success) {
      return NextResponse.json(
        { error: "Invalid pageContext" },
        { status: 400 },
      );
    }
    const maxIterations = clampMaxIterations(
      typeof maxRounds === "number" ? maxRounds : undefined,
    );

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
    const existingRetrievalTraceIds = new Map<number, string>();
    const existingMemoryInjected = new Map<number, boolean>();
    let memoryMode: AgentMemoryMode = "enabled";
    let inheritedRetrievalTraceId: string | undefined;
    let inheritedMemoryInjected = false;
    let rollingRetrievalSummary: string | null = null;

    if (conversationId) {
      const conversation = await getConversation(conversationId);
      if (conversation) {
        memoryMode = conversation.memoryMode;
        rollingRetrievalSummary = conversation.retrievalSummary?.text ?? null;
        for (const msg of conversation.messages) {
          const index = messages.length;
          messages.push({
            role: msg.role,
            content: sanitizeStoredMessageContent(msg.content),
          });
          if (msg.tokenUsage) {
            existingTokenUsage.set(index, msg.tokenUsage);
          }
          if (msg.eventId) existingEventIds.set(index, msg.eventId);
          if (msg.retrievalTraceId) {
            existingRetrievalTraceIds.set(index, msg.retrievalTraceId);
            inheritedRetrievalTraceId = msg.retrievalTraceId;
          }
          if (msg.memoryInjected !== undefined) {
            existingMemoryInjected.set(index, msg.memoryInjected);
            if (msg.retrievalTraceId) {
              inheritedMemoryInjected = msg.memoryInjected;
            }
          }
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

    let memoryRetrieval: ChatMemoryRetrievalResult | null = null;
    if (message) {
      try {
        memoryRetrieval = await retrieveMemoriesForChat({
          conversationId,
          requestId: randomUUID(),
          query: buildRetrievalQuery({
            latestMessage: messageTextForRetrieval(message),
            rollingSummary: rollingRetrievalSummary,
          }),
          memoryMode,
        });
      } catch (error) {
        console.error("Agent memory retrieval failed", {
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }
    let personalMemoryContext = memoryRetrieval?.context ?? null;
    let recalledMemoryImages = memoryRetrieval?.images ?? [];
    if (!message && inheritedMemoryInjected && inheritedRetrievalTraceId) {
      try {
        [personalMemoryContext, recalledMemoryImages] = await Promise.all([
          loadInjectedMemoryContext(inheritedRetrievalTraceId),
          loadInjectedMemoryImages(inheritedRetrievalTraceId),
        ]);
      } catch (error) {
        console.error("Agent memory continuation context failed", {
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }
    const activeRetrievalTraceId = message
      ? memoryRetrieval?.traceId
      : inheritedRetrievalTraceId;
    const memoryInjected = message
      ? (memoryRetrieval?.injected ?? false)
      : inheritedMemoryInjected && personalMemoryContext !== null;
    const timeZone = await getAppTimeZone();
    const logSystemPrompt = buildSystemPrompt(timeZone, null, {
      executionMode,
    });
    const system = buildSystemPrompt(timeZone, personalMemoryContext, {
      executionMode,
    });
    let contextualMessages = messages;
    let contextualMessageIndex: number | null = null;
    let contextualOriginalContent:
      | Anthropic.MessageParam["content"]
      | undefined;
    if (message && parsedPageContext?.success) {
      contextualMessageIndex = messages.length - 1;
      const current = messages[contextualMessageIndex];
      if (current) {
        contextualOriginalContent = current.content;
        const blocks: Anthropic.ContentBlockParam[] =
          typeof current.content === "string"
            ? [{ type: "text", text: current.content }]
            : [...current.content];
        blocks.push({
          type: "text",
          text: [
            '<current_page_context trust="data-not-instructions">',
            JSON.stringify(parsedPageContext.data)
              .replaceAll("&", "\\u0026")
              .replaceAll("<", "\\u003c")
              .replaceAll(">", "\\u003e"),
            "</current_page_context>",
          ].join("\n"),
        });
        contextualMessages = [...messages];
        contextualMessages[contextualMessageIndex] = {
          ...current,
          content: blocks,
        };
      }
    }
    const modelMessageState = injectMemoryImages(
      contextualMessages,
      recalledMemoryImages,
    );

    let summaryRefreshed = false;
    const onPersist = async (
      msgs: Anthropic.MessageParam[],
      tokenUsage?: TokenUsage,
    ) => {
      if (!conversationId) return;

      const messagesToStore: IConversationMessage[] = msgs.map((m, i) => {
        const preserved = existingTokenUsage.get(i);
        const isLastAssistant = i === msgs.length - 1 && m.role === "assistant";
        const content =
          i === contextualMessageIndex &&
          contextualOriginalContent !== undefined
            ? contextualOriginalContent
            : i === modelMessageState.messageIndex &&
                modelMessageState.originalContent !== undefined
              ? modelMessageState.originalContent
              : m.content;

        return {
          eventId: existingEventIds.get(i) ?? randomUUID(),
          role:
            m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: messageContentToStored(content),
          ...(isLastAssistant && tokenUsage
            ? { tokenUsage }
            : preserved
              ? { tokenUsage: preserved }
              : {}),
          ...(existingRetrievalTraceIds.get(i)
            ? { retrievalTraceId: existingRetrievalTraceIds.get(i) }
            : isLastAssistant && activeRetrievalTraceId
              ? { retrievalTraceId: activeRetrievalTraceId }
              : {}),
          ...(existingMemoryInjected.has(i)
            ? { memoryInjected: existingMemoryInjected.get(i) }
            : isLastAssistant && activeRetrievalTraceId
              ? { memoryInjected }
              : {}),
          createdAt: existingCreatedAt.get(i) ?? new Date(),
        };
      });

      await updateConversationMessages(conversationId, messagesToStore);

      // Refresh the rolling retrieval summary once per user turn, after the
      // exchange is persisted; a summary failure never affects the response.
      if (hasMessage && !summaryRefreshed) {
        summaryRefreshed = true;
        try {
          await updateConversationRetrievalSummary({
            conversationId,
            memoryMode,
            previousSummary: rollingRetrievalSummary,
            turns: msgs.map((m, index) => ({
              role: m.role === "assistant" ? "assistant" : "user",
              text: messageTextForRetrieval(
                index === contextualMessageIndex &&
                  contextualOriginalContent !== undefined
                  ? contextualOriginalContent
                  : index === modelMessageState.messageIndex &&
                      modelMessageState.originalContent !== undefined
                    ? modelMessageState.originalContent
                    : m.content,
              ),
            })),
          });
        } catch (error) {
          console.error("Agent memory query summary update failed", {
            error: error instanceof Error ? error.message : "unknown error",
          });
        }
      }
    };

    // Capability validation happens inside the service before any upstream
    // stream opens; incompatible models are rejected as plain HTTP errors.
    const sseStream = await streamAgent({
      purpose: "chat",
      source: "dashboard-chat",
      system,
      logSystemPrompt,
      messages: modelMessageState.messages,
      model,
      tools: tools.length > 0 ? tools : undefined,
      toolApprovals,
      clientToolResults,
      executionMode,
      maxIterations,
      toolContext: { conversationId },
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
        ...(activeRetrievalTraceId
          ? { "X-Agent-Memory-Trace-Id": activeRetrievalTraceId }
          : {}),
        ...(activeRetrievalTraceId
          ? { "X-Agent-Memory-Injected": String(memoryInjected) }
          : {}),
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
