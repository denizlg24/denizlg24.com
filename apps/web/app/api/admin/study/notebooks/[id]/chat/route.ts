import { type AgentUIMessage, agentChatRequestSchema } from "@repo/schemas";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { Types } from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import {
  AgentMergeError,
  applyClientDecisions,
  hasPendingWork,
  sanitizeUserMessage,
  truncateForRegenerate,
} from "@/lib/agent/merge";
import { messageText } from "@/lib/agent/messages";
import {
  CITATIONS_PART_ID,
  CitationRegistry,
  withCitations,
} from "@/lib/agent/study-citations";
import { STUDY_INSTRUCTIONS } from "@/lib/agent/study-prompt";
import { buildStudyTools } from "@/lib/agent/study-tools";
import { startAgentTurn } from "@/lib/agent/turn";
import { getConversation, saveConversationMessages } from "@/lib/conversations";
import {
  CatalogUnavailableError,
  LlmConfigurationError,
  LlmModelError,
} from "@/lib/llm-errors";
import { connectDB } from "@/lib/mongodb";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireAdmin } from "@/lib/require-admin";
import {
  NotebookNotFoundError,
  resolveNotebookSourceKeys,
} from "@/lib/study/notebook-sources";
import { Conversation } from "@/models/Conversation";

export const maxDuration = 300;

const THREAD_LIST_LIMIT = 100;

type RouteContext = { params: Promise<{ id: string }> };

async function notebookExists(id: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  try {
    await resolveNotebookSourceKeys(id);
    return true;
  } catch (error) {
    if (error instanceof NotebookNotFoundError) return false;
    throw error;
  }
}

function resolveHistory(
  stored: AgentUIMessage[],
  request: {
    trigger: "submit-message" | "regenerate-message";
    message?: AgentUIMessage;
    messageId?: string;
  },
): AgentUIMessage[] {
  if (request.trigger === "regenerate-message") {
    if (!request.messageId) {
      throw new AgentMergeError("messageId is required to regenerate", 400);
    }
    return truncateForRegenerate(stored, request.messageId);
  }
  if (!request.message) {
    throw new AgentMergeError("message is required", 400);
  }
  if (request.message.role === "assistant") {
    return applyClientDecisions(stored, request.message);
  }
  if (hasPendingWork(stored)) {
    throw new AgentMergeError(
      "Resolve the pending tool call before sending a new message",
      409,
    );
  }
  return [...stored, sanitizeUserMessage(request.message)];
}

/**
 * Adds the `data-citations` part just before the stream's `finish`, built from
 * the `[n]` the answer actually used. A resumed turn starts from the text the
 * assistant message already had.
 */
function withCitationsPart(
  stream: ReadableStream<UIMessageChunk>,
  registry: CitationRegistry,
  initialText: string,
): ReadableStream<UIMessageChunk> {
  let text = initialText;
  return stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        if (chunk.type === "text-delta") text += chunk.delta;
        if (chunk.type === "finish") {
          const citations = registry.citationsFor(text);
          if (citations.length > 0) {
            controller.enqueue({
              type: "data-citations",
              id: CITATIONS_PART_ID,
              data: citations,
            });
          }
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

export const GET = async (req: NextRequest, { params }: RouteContext) => {
  const adminError = await requireAdmin(req);
  if (adminError) return adminError;
  const { id } = await params;
  if (!(await notebookExists(id))) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }
  await connectDB();
  const rows = await Conversation.find({ notebookId: id })
    .select("title updatedAt")
    .sort({ updatedAt: -1, _id: -1 })
    .limit(THREAD_LIST_LIMIT)
    .lean<{ _id: Types.ObjectId; title: string; updatedAt: Date }[]>();
  return NextResponse.json({
    conversations: rows.map((row) => ({
      id: row._id.toString(),
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
};

export const POST = async (req: NextRequest, { params }: RouteContext) => {
  const adminError = await requireAdmin(req);
  if (adminError) return adminError;
  const { id: notebookId } = await params;

  const parsed = agentChatRequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const request = parsed.data;
  if (!Types.ObjectId.isValid(request.conversationId)) {
    return NextResponse.json(
      { error: "Invalid conversationId" },
      { status: 400 },
    );
  }

  try {
    if (!(await notebookExists(notebookId))) {
      return NextResponse.json(
        { error: "Notebook not found" },
        { status: 404 },
      );
    }
    await connectDB();
    const tag = await Conversation.findById(request.conversationId)
      .select("notebookId")
      .lean<{ notebookId?: Types.ObjectId } | null>();
    if (!tag) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }
    if (tag.notebookId && tag.notebookId.toString() !== notebookId) {
      return NextResponse.json(
        { error: "Conversation belongs to another notebook" },
        { status: 409 },
      );
    }
    // Persisted before the turn: evidence observation reads the stored mode.
    await Conversation.updateOne(
      { _id: request.conversationId },
      { $set: { notebookId, memoryMode: "incognito" } },
    );

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const { allowed, resetMs } = await checkRateLimit(`study-chat:${ip}`, {
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

    const conversation = await getConversation(request.conversationId);
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }
    const history = resolveHistory(conversation.messages, request);
    const registry = CitationRegistry.fromHistory(history);
    const study = buildStudyTools({ notebookId, registry });
    const last = history.at(-1);
    const initialText = last?.role === "assistant" ? messageText(last) : "";

    const stream = await startAgentTurn({
      purpose: "chat",
      source: "study-chat",
      model: request.model,
      surface: "user-chat",
      unattended: false,
      executionMode: request.executionMode,
      memoryMode: "incognito",
      conversationId: conversation._id,
      messages: history,
      toolToggles: request.tools,
      connectors: [],
      pageTools: false,
      memory: { context: null, images: [], injected: false },
      extraTools: study.tools,
      extraWrites: study.writes,
      extraInstructions: STUDY_INSTRUCTIONS,
      abortSignal: req.signal,
      onFinish: async ({ messages }) => {
        await saveConversationMessages(
          conversation._id,
          withCitations(messages, registry),
          { llmModel: request.model },
        );
      },
    });

    return createUIMessageStreamResponse({
      stream: withCitationsPart(stream, registry, initialText),
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
    console.error("Study chat route error:", error);
    return NextResponse.json(
      { error: "Failed to process chat request" },
      { status: 500 },
    );
  }
};
