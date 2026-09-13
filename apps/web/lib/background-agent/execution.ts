import { randomUUID } from "node:crypto";
import type {
  AgentUIMessage,
  AgentUIMessagePart,
  CreateBackgroundAgentRun,
} from "@repo/schemas";
import mongoose, { Types } from "mongoose";
import { recallForTurn } from "@/lib/agent/memory";
import { messageText } from "@/lib/agent/messages";
import { startAgentTurn } from "@/lib/agent/turn";
import {
  AGENT_MEMORY_JOB_LEASE_MS,
  completeMemoryJob,
  failMemoryJob,
  leaseNextMemoryJob,
} from "@/lib/agent-memory/jobs";
import {
  createConversation,
  getConversation,
  saveConversationMessages,
} from "@/lib/conversations";
import { clampMaxRounds } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { AgentMemoryJob, type IAgentMemoryJob } from "@/models/AgentMemoryJob";
import {
  BackgroundAgentRun,
  type IBackgroundAgentRun,
} from "@/models/BackgroundAgentRun";
import { consumeUIMessageStream } from "./consume-stream";

function lastAssistantText(messages: readonly AgentUIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    return messageText(message).slice(0, 64_000);
  }
  return "";
}

function runUserMessage(run: IBackgroundAgentRun): AgentUIMessage {
  const parts: AgentUIMessagePart[] = run.attachments.map((attachment) => ({
    type: "file",
    mediaType: attachment.type === "image" ? "image" : "application/pdf",
    url: attachment.url,
    filename: attachment.name,
  }));
  if (run.prompt) parts.push({ type: "text", text: run.prompt });
  return {
    id: randomUUID(),
    role: "user",
    parts,
    metadata: {
      createdAt: new Date().toISOString(),
      ...(run.pageContext
        ? {
            page: {
              pathname: run.pageContext.pathname,
              ...(run.pageContext.title
                ? { title: run.pageContext.title }
                : {}),
            },
          }
        : {}),
    },
  };
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
            maxRounds: clampMaxRounds(input.maxRounds),
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

  let finalMessages: AgentUIMessage[] = [];
  let tokenUsage: IBackgroundAgentRun["tokenUsage"];
  try {
    const conversationId = run.conversationId.toString();
    const conversation = await getConversation(conversationId);
    if (!conversation) throw new Error("Conversation not found");

    const user = runUserMessage(run);
    const history = [...conversation.messages, user];
    const memory = await recallForTurn({
      conversationId,
      memoryMode: conversation.memoryMode,
      latestText:
        run.prompt ||
        run.attachments.map((attachment) => attachment.name).join(" "),
      rollingSummary: conversation.retrievalSummary?.text ?? null,
      history,
    });

    const stream = await startAgentTurn({
      purpose: "chat",
      source: `background-chat:${run._id.toString()}`,
      model: run.llmModel,
      surface: "background-agent",
      unattended: true,
      executionMode: "yolo",
      memoryMode: conversation.memoryMode,
      conversationId,
      messages: history,
      toolToggles: { webSearch: false, webFetch: false, thinkLonger: false },
      maxRounds: run.maxRounds,
      pageContext: run.pageContext,
      pageTools: false,
      memory,
      onFinish: async ({ messages, responseMessage }) => {
        finalMessages = messages;
        tokenUsage = responseMessage.metadata?.usage;
        await saveConversationMessages(conversationId, messages);
      },
    });
    await consumeUIMessageStream(stream);
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
