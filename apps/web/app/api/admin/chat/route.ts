import {
  type AgentUIMessage,
  agentChatRequestSchema,
  MOBILE_INSTALLATION_HEADER,
} from "@repo/schemas";
import { interruptMessage } from "@repo/utils/agent-live";
import { pendingApprovals, replyText } from "@repo/utils/agent-stream";
import { createIdGenerator, createUIMessageStreamResponse } from "ai";
import { after, type NextRequest, NextResponse } from "next/server";
import { beginDurableTurn, type DurableTurn } from "@/lib/agent/durable-turn";
import { resolveHistory } from "@/lib/agent/history";
import { recallForTurn } from "@/lib/agent/memory";
import { AgentMergeError } from "@/lib/agent/merge";
import { messageText } from "@/lib/agent/messages";
import { startAgentTurn } from "@/lib/agent/turn";
import {
  claimTurn,
  dequeueMessage,
  finalizeTurn,
  heartbeatTurn,
  setQueuePaused,
} from "@/lib/agent/turn-store";
import { updateConversationRetrievalSummary } from "@/lib/agent-memory/query-context";
import { getConversation, saveConversationMessages } from "@/lib/conversations";
import {
  CatalogUnavailableError,
  LlmConfigurationError,
  LlmModelError,
} from "@/lib/llm-errors";
import { scheduleDashboardPush } from "@/lib/mobile-push";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireAdmin } from "@/lib/require-admin";

export const maxDuration = 300;

const generateTurnId = createIdGenerator({ prefix: "turn", size: 16 });

function announceReply(
  conversationId: string,
  title: string,
  messages: AgentUIMessage[],
) {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return;
  const waiting = pendingApprovals(last).length > 0;
  const line = replyText(last)
    .split("\n")
    .find((row) => row.trim())
    ?.trim();
  scheduleDashboardPush({
    kind: "chat_reply",
    title: waiting ? `${title} · approval needed` : title,
    ...(line && !waiting ? { body: line.slice(0, 140) } : {}),
    subject: conversationId,
    url: `dashboard://chat/${conversationId}`,
  });
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

  let turn: DurableTurn | null = null;
  try {
    const conversation = await getConversation(request.conversationId);
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }
    const turnId = generateTurnId();
    const claim = await claimTurn(conversation._id, turnId, {
      ...(request.queuedMessageId
        ? { queuedMessageId: request.queuedMessageId }
        : {}),
    });
    if (claim !== "claimed") {
      return NextResponse.json(
        {
          error:
            claim === "not-queued"
              ? "This message was already sent"
              : "A turn is already running in this conversation",
        },
        { status: 409 },
      );
    }
    const conversationId = conversation._id;
    turn = beginDurableTurn({
      conversationId,
      turnId,
      store: {
        heartbeat: (snapshot) =>
          heartbeatTurn(conversationId, turnId, snapshot),
        finalize: async () => {
          await finalizeTurn(conversationId, turnId);
        },
      },
      onError: (error) => console.error("Agent turn error:", error),
    });
    const durable = turn;

    // Re-read after the claim: a dead turn's partial reply was settled by it.
    const stored = (await getConversation(conversationId)) ?? conversation;
    const { history, newUserText } = resolveHistory(stored.messages, request);
    // The thread as the turn starts is stored before the model is called, so
    // the message survives a turn that dies, and a retry finds it.
    const saved = await saveConversationMessages(conversationId, history, {
      llmModel: request.model,
      whileTurnId: turnId,
    });
    if (!saved) {
      await durable.fail();
      return NextResponse.json(
        { error: "The conversation changed while the turn started" },
        { status: 409 },
      );
    }
    // Only once the message is in the thread: dequeued first and then a
    // failed save, it would be in neither.
    if (request.queuedMessageId) {
      await dequeueMessage(conversationId, request.queuedMessageId);
    } else if (newUserText !== null) {
      // A message typed after a stop resumes the queue behind it.
      await setQueuePaused(conversationId, false);
    }
    const background: Promise<unknown>[] = [];

    const memory = await recallForTurn({
      conversationId: conversation._id,
      memoryMode: conversation.memoryMode,
      latestText: newUserText,
      rollingSummary: conversation.retrievalSummary?.text ?? null,
      history,
    });

    // A turn the dashboard app started can finish after it was put away; the
    // app hides the banner itself while it is in the foreground.
    const fromPhone = req.headers.has(MOBILE_INSTALLATION_HEADER);
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
      pageTools: request.pageTools,
      questions: request.questions,
      memory,
      // The turn's own signal, not the request's: closing the tab or
      // refreshing leaves the turn running; only a stop ends it early.
      abortSignal: durable.signal,
      onFinish: async ({ messages, isAborted }) => {
        const settled = isAborted
          ? messages.map((message, index) =>
              index === messages.length - 1 && message.role === "assistant"
                ? interruptMessage(message)
                : message,
            )
          : messages;
        const ended = await saveConversationMessages(
          conversation._id,
          settled,
          { llmModel: request.model, endTurnId: turnId },
        );
        // A turn that lost the thread to a newer one writes nothing more.
        if (!ended) return;
        durable.released();
        if (fromPhone && !isAborted) {
          announceReply(
            conversation._id.toString(),
            conversation.title,
            settled,
          );
        }
        if (newUserText === null) return;
        // An LLM call: kept off the stream so the turn's end reaches its
        // readers without waiting on it.
        background.push(
          updateConversationRetrievalSummary({
            conversationId: conversation._id,
            memoryMode: conversation.memoryMode,
            previousSummary: conversation.retrievalSummary?.text ?? null,
            turns: settled.map((message) => ({
              role: message.role === "assistant" ? "assistant" : "user",
              text: messageText(message),
            })),
          }).catch((error: unknown) => {
            console.error("Agent memory query summary update failed", {
              error: error instanceof Error ? error.message : "unknown error",
            });
          }),
        );
      },
    });

    const last = history.at(-1);
    const response = durable.attach(
      stream,
      last?.role === "assistant" ? last : undefined,
    );
    after(async () => {
      await durable.done;
      await Promise.allSettled(background);
    });

    return createUIMessageStreamResponse({
      stream: response,
      headers: {
        "X-Agent-Turn-Id": turnId,
        ...(memory.traceId
          ? {
              "X-Agent-Memory-Trace-Id": memory.traceId,
              "X-Agent-Memory-Injected": String(memory.injected),
            }
          : {}),
      },
    });
  } catch (error) {
    await turn?.fail();
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
