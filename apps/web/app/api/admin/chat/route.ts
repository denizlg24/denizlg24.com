import { type AgentUIMessage, agentChatRequestSchema } from "@repo/schemas";
import { createUIMessageStreamResponse } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { recallForTurn } from "@/lib/agent/memory";
import {
  AgentMergeError,
  applyClientDecisions,
  hasPendingWork,
  sanitizeUserMessage,
  truncateForRegenerate,
} from "@/lib/agent/merge";
import { messageText } from "@/lib/agent/messages";
import { startAgentTurn } from "@/lib/agent/turn";
import { updateConversationRetrievalSummary } from "@/lib/agent-memory/query-context";
import { getConversation, saveConversationMessages } from "@/lib/conversations";
import {
  CatalogUnavailableError,
  LlmConfigurationError,
  LlmModelError,
} from "@/lib/llm-errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireAdmin } from "@/lib/require-admin";

export const maxDuration = 300;

function resolveHistory(
  stored: AgentUIMessage[],
  request: {
    trigger: "submit-message" | "regenerate-message";
    message?: AgentUIMessage;
    messageId?: string;
  },
): { history: AgentUIMessage[]; newUserText: string | null } {
  if (request.trigger === "regenerate-message") {
    if (!request.messageId) {
      throw new AgentMergeError("messageId is required to regenerate", 400);
    }
    const history = truncateForRegenerate(stored, request.messageId);
    const last = history.at(-1);
    return {
      history,
      newUserText: last?.role === "user" ? messageText(last) : null,
    };
  }
  if (!request.message) {
    throw new AgentMergeError("message is required", 400);
  }
  if (request.message.role === "assistant") {
    return {
      history: applyClientDecisions(stored, request.message),
      newUserText: null,
    };
  }
  if (hasPendingWork(stored)) {
    throw new AgentMergeError(
      "Resolve the pending tool call before sending a new message",
      409,
    );
  }
  const user = sanitizeUserMessage(request.message);
  return { history: [...stored, user], newUserText: messageText(user) };
}

export const POST = async (req: NextRequest) => {
  const adminError = await requireAdmin(req);
  if (adminError) return adminError;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed, resetMs } = await checkRateLimit(`chat:${ip}`, {
    maxRequests: 10,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) },
      },
    );
  }

  const parsed = agentChatRequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const request = parsed.data;

  try {
    const conversation = await getConversation(request.conversationId);
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }
    const { history, newUserText } = resolveHistory(
      conversation.messages,
      request,
    );
    const memory = await recallForTurn({
      conversationId: conversation._id,
      memoryMode: conversation.memoryMode,
      latestText: newUserText,
      rollingSummary: conversation.retrievalSummary?.text ?? null,
      history,
    });

    const stream = await startAgentTurn({
      purpose: "chat",
      source: "dashboard-chat",
      model: request.model,
      surface: request.responseStyle === "voice" ? "user-voice" : "user-chat",
      unattended: false,
      executionMode: request.executionMode,
      memoryMode: conversation.memoryMode,
      conversationId: conversation._id,
      messages: history,
      toolToggles: request.tools,
      connectors: request.connectors,
      pageContext: request.pageContext,
      responseStyle: request.responseStyle,
      pageTools: true,
      memory,
      abortSignal: req.signal,
      onFinish: async ({ messages }) => {
        await saveConversationMessages(conversation._id, messages, {
          llmModel: request.model,
        });
        if (newUserText === null) return;
        try {
          await updateConversationRetrievalSummary({
            conversationId: conversation._id,
            memoryMode: conversation.memoryMode,
            previousSummary: conversation.retrievalSummary?.text ?? null,
            turns: messages.map((message) => ({
              role: message.role === "assistant" ? "assistant" : "user",
              text: messageText(message),
            })),
          });
        } catch (error) {
          console.error("Agent memory query summary update failed", {
            error: error instanceof Error ? error.message : "unknown error",
          });
        }
      },
    });

    return createUIMessageStreamResponse({
      stream,
      headers: {
        ...(memory.traceId
          ? {
              "X-Agent-Memory-Trace-Id": memory.traceId,
              "X-Agent-Memory-Injected": String(memory.injected),
            }
          : {}),
      },
    });
  } catch (error) {
    if (error instanceof AgentMergeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
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
