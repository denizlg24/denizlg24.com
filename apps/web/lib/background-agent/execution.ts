import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  BackgroundAgentPageContext,
  CreateBackgroundAgentRun,
} from "@repo/schemas";
import mongoose, { Types } from "mongoose";
import {
  AGENT_MEMORY_JOB_LEASE_MS,
  completeMemoryJob,
  failMemoryJob,
  leaseNextMemoryJob,
} from "@/lib/agent-memory/jobs";
import { injectMemoryImages } from "@/lib/agent-memory/message-images";
import { buildRetrievalQuery } from "@/lib/agent-memory/query-context";
import { retrieveMemoriesForChat } from "@/lib/agent-memory/retrieval";
import {
  createConversation,
  getConversation,
  updateConversationMessages,
} from "@/lib/conversations";
import { clampMaxIterations } from "@/lib/llm-chat";
import {
  messageContentToStored,
  sanitizeStoredMessageContent,
} from "@/lib/llm-message-storage";
import { streamAgent } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { getAppTimeZone } from "@/lib/timezone";
import { getToolSchemas, isClientTool } from "@/lib/tools/registry";
import { buildSystemPrompt } from "@/lib/tools/system-prompt";
import { AgentMemoryJob, type IAgentMemoryJob } from "@/models/AgentMemoryJob";
import {
  BackgroundAgentRun,
  type IBackgroundAgentRun,
} from "@/models/BackgroundAgentRun";
import type { IConversationMessage, TokenUsage } from "@/models/Conversation";
import { consumeAgentStream } from "./consume-stream";

function pageContextText(context: BackgroundAgentPageContext | undefined) {
  if (!context) return "";
  return [
    '<current_page_context trust="data-not-instructions">',
    JSON.stringify(context)
      .replaceAll("&", "\\u0026")
      .replaceAll("<", "\\u003c")
      .replaceAll(">", "\\u003e"),
    "</current_page_context>",
  ].join("\n");
}

function messageText(content: Anthropic.MessageParam["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block): block is Anthropic.TextBlockParam => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function lastAssistantText(messages: Anthropic.MessageParam[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    return messageText(message.content).slice(0, 64_000);
  }
  return "";
}

export async function enqueueBackgroundAgentRun(
  input: CreateBackgroundAgentRun,
): Promise<IBackgroundAgentRun> {
  await connectDB();
  let conversationId = input.conversationId;
  if (conversationId) {
    const conversation = await getConversation(conversationId);
    if (!conversation) throw new Error("Conversation not found");
  }

  const session = await mongoose.startSession();
  let run: IBackgroundAgentRun | null = null;
  try {
    await session.withTransaction(async () => {
      if (!conversationId) {
        const titleSource =
          input.prompt || input.attachments[0]?.name || "Background task";
        const title =
          titleSource.length > 50
            ? `${titleSource.slice(0, 50)}...`
            : titleSource;
        const conversation = await createConversation(
          {
            title,
            llmModel: input.model,
            memoryMode: "enabled",
          },
          { session },
        );
        conversationId = conversation._id.toString();
      }
      [run] = await BackgroundAgentRun.create(
        [
          {
            conversationId,
            prompt: input.prompt,
            llmModel: input.model,
            pageContext: input.pageContext,
            attachments: input.attachments,
            maxRounds: clampMaxIterations(input.maxRounds),
            status: "queued",
          },
        ],
        { session },
      );
      await AgentMemoryJob.create(
        [
          {
            idempotencyKey: `chat-run:${run._id.toString()}`,
            operation: "chat-run",
            evidenceIds: [],
            memoryIds: [],
            status: "pending",
            attempts: 0,
            availableAt: new Date(),
            checkpoint: { backgroundRunId: run._id.toString() },
          },
        ],
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
  if (!run) throw new Error("Background run transaction did not complete");
  return run;
}

export async function processBackgroundAgentJob(job: IAgentMemoryJob) {
  const runId =
    typeof job.checkpoint?.backgroundRunId === "string"
      ? job.checkpoint.backgroundRunId
      : "";
  if (!runId || !Types.ObjectId.isValid(runId)) {
    return { failed: true, reason: "background-run-missing" };
  }
  if (!job.leaseOwner) {
    throw new Error("Background agent job is missing an execution lease");
  }
  await connectDB();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - AGENT_MEMORY_JOB_LEASE_MS);
  const executionLeaseExpiresAt =
    job.leaseExpiresAt && job.leaseExpiresAt > now
      ? job.leaseExpiresAt
      : new Date(now.getTime() + AGENT_MEMORY_JOB_LEASE_MS);
  let run = await BackgroundAgentRun.findOneAndUpdate(
    { _id: runId, status: "queued" },
    {
      $set: {
        status: "running",
        startedAt: now,
        executionLeaseOwner: job.leaseOwner,
        executionLeaseExpiresAt,
      },
      $unset: { error: 1, completedAt: 1 },
    },
    { returnDocument: "after" },
  );

  if (!run) {
    const current = await BackgroundAgentRun.findById(runId);
    if (!current) return { failed: true, reason: "background-run-missing" };
    if (["completed", "failed", "cancelled"].includes(current.status)) {
      return { skipped: true, runId };
    }
    if (current.status !== "running") return { skipped: true, runId };

    run = await BackgroundAgentRun.findOneAndUpdate(
      {
        _id: runId,
        status: "running",
        $or: [
          { executionLeaseExpiresAt: { $lte: now } },
          {
            executionLeaseExpiresAt: { $exists: false },
            $or: [
              { startedAt: { $lte: staleBefore } },
              {
                startedAt: { $exists: false },
                updatedAt: { $lte: staleBefore },
              },
            ],
          },
        ],
      },
      {
        $set: {
          executionLeaseOwner: job.leaseOwner,
          executionLeaseExpiresAt,
        },
      },
      { returnDocument: "after" },
    );
    if (!run) return { skipped: true, runId };

    console.error("[Background Agent] Recovered stale running run", {
      runId,
      startedAt: run.startedAt?.toISOString(),
    });
    run.status = "failed";
    run.error =
      "Background execution was interrupted after it began; partial side effects may have completed.";
    run.completedAt = now;
    run.executionLeaseOwner = undefined;
    run.executionLeaseExpiresAt = undefined;
    await run.save();
    return { failed: true, runId, error: run.error };
  }

  let finalMessages: Anthropic.MessageParam[] = [];
  let tokenUsage: TokenUsage | undefined;
  try {
    const conversation = await getConversation(run.conversationId.toString());
    if (!conversation) throw new Error("Conversation not found");

    const messages: Anthropic.MessageParam[] = conversation.messages.map(
      (message) => ({
        role: message.role,
        content: sanitizeStoredMessageContent(message.content),
      }),
    );
    const userIndex = messages.length;
    const context = pageContextText(run.pageContext);
    const persistentUserContent: Anthropic.ContentBlockParam[] = [];
    for (const attachment of run.attachments) {
      if (attachment.type === "image") {
        persistentUserContent.push({
          type: "image",
          source: { type: "url", url: attachment.url },
        });
      } else {
        persistentUserContent.push({
          type: "document",
          source: { type: "url", url: attachment.url },
          title: attachment.name,
        });
      }
    }
    if (run.prompt) {
      persistentUserContent.push({ type: "text", text: run.prompt });
    }
    const modelUserContent = [...persistentUserContent];
    if (context) modelUserContent.push({ type: "text", text: context });
    messages.push({ role: "user", content: modelUserContent });

    const eventIds = new Map(
      conversation.messages.map((message, index) => [index, message.eventId]),
    );
    const createdAt = new Map(
      conversation.messages.map((message, index) => [index, message.createdAt]),
    );
    eventIds.set(userIndex, randomUUID());
    createdAt.set(userIndex, new Date());

    const query = buildRetrievalQuery({
      latestMessage:
        run.prompt ||
        run.attachments.map((attachment) => attachment.name).join(" "),
    });
    const [retrieval, timeZone] = await Promise.all([
      retrieveMemoriesForChat({
        conversationId: run.conversationId.toString(),
        requestId: randomUUID(),
        query,
        memoryMode: conversation.memoryMode,
      }).catch(() => null),
      getAppTimeZone(),
    ]);
    const imageState = injectMemoryImages(messages, retrieval?.images ?? []);
    const system = buildSystemPrompt(timeZone, retrieval?.context ?? null, {
      executionMode: "yolo",
      clientToolsAvailable: false,
    });
    const logSystemPrompt = buildSystemPrompt(timeZone, null, {
      executionMode: "yolo",
      clientToolsAvailable: false,
    });
    const tools = getToolSchemas()
      .filter((schema) => !isClientTool(schema.name))
      .map((schema) => ({
        name: schema.name,
        description: schema.description,
        input_schema: schema.input_schema,
      }));

    const persist = async (
      nextMessages: Anthropic.MessageParam[],
      usage?: TokenUsage,
    ) => {
      finalMessages = structuredClone(nextMessages);
      if (usage) tokenUsage = usage;
      const stored: IConversationMessage[] = nextMessages.map(
        (message, index) => {
          const persistentContent =
            index === userIndex
              ? persistentUserContent
              : index === imageState.messageIndex &&
                  imageState.originalContent !== undefined
                ? imageState.originalContent
                : message.content;
          const assignedEventId = eventIds.get(index) ?? randomUUID();
          eventIds.set(index, assignedEventId);
          const assignedCreatedAt = createdAt.get(index) ?? new Date();
          createdAt.set(index, assignedCreatedAt);
          const isLastAssistant =
            index === nextMessages.length - 1 &&
            message.role === "assistant" &&
            usage;
          return {
            eventId: assignedEventId,
            role:
              message.role === "assistant"
                ? ("assistant" as const)
                : ("user" as const),
            content: messageContentToStored(persistentContent),
            ...(isLastAssistant ? { tokenUsage: usage } : {}),
            ...(isLastAssistant && retrieval?.traceId
              ? {
                  retrievalTraceId: retrieval.traceId,
                  memoryInjected: retrieval.injected,
                }
              : {}),
            createdAt: assignedCreatedAt,
          };
        },
      );
      await updateConversationMessages(run.conversationId.toString(), stored);
      const output = lastAssistantText(nextMessages);
      if (output) {
        await BackgroundAgentRun.updateOne(
          { _id: run._id, status: "running" },
          { $set: { output } },
        );
      }
    };

    const stream = await streamAgent({
      purpose: "chat",
      source: `background-chat:${run._id.toString()}`,
      system,
      logSystemPrompt,
      messages: imageState.messages,
      model: run.llmModel,
      tools,
      executionMode: "yolo",
      maxIterations: run.maxRounds,
      toolContext: {
        conversationId: run.conversationId.toString(),
        memoryMode: conversation.memoryMode,
      },
      onPersist: persist,
      requireTools: true,
    });
    await consumeAgentStream(stream);
    run.status = "completed";
    run.output =
      lastAssistantText(finalMessages) || "Completed without a text response.";
    run.tokenUsage = tokenUsage;
    run.completedAt = new Date();
    run.executionLeaseOwner = undefined;
    run.executionLeaseExpiresAt = undefined;
    await run.save();
    return { runId, status: run.status };
  } catch (error) {
    run.status = "failed";
    const partialOutput = lastAssistantText(finalMessages);
    if (partialOutput) run.output = partialOutput;
    run.tokenUsage = tokenUsage;
    run.error =
      error instanceof Error
        ? error.message.slice(0, 4_096)
        : "Background agent run failed";
    run.completedAt = new Date();
    run.executionLeaseOwner = undefined;
    run.executionLeaseExpiresAt = undefined;
    await run.save();
    return { runId, failed: true, error: run.error };
  }
}

export async function drainOneBackgroundAgentJob(backgroundRunId?: string) {
  const workerId = `background-route:${randomUUID()}`;
  const now = new Date();
  const job = backgroundRunId
    ? await AgentMemoryJob.findOneAndUpdate(
        {
          idempotencyKey: `chat-run:${backgroundRunId}`,
          operation: "chat-run",
          status: { $in: ["pending", "retry"] },
          availableAt: { $lte: now },
        },
        {
          $set: {
            status: "leased",
            leaseOwner: workerId,
            leaseExpiresAt: new Date(now.getTime() + AGENT_MEMORY_JOB_LEASE_MS),
          },
          $inc: { attempts: 1 },
        },
        { returnDocument: "after" },
      )
    : await leaseNextMemoryJob({
        workerId,
        operations: ["chat-run"],
      });
  if (!job) return null;
  try {
    const result = await processBackgroundAgentJob(job);
    await completeMemoryJob(job._id.toString(), workerId);
    return result;
  } catch (error) {
    await failMemoryJob({
      jobId: job._id.toString(),
      workerId,
      attempt: job.attempts,
      error,
    });
    throw error;
  }
}
