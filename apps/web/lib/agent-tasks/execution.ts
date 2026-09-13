import { randomUUID } from "node:crypto";
import type { AgentUIMessage, AgentUIMessagePart } from "@repo/schemas";
import {
  isAgentToolPart,
  messageText,
  toolOutputText,
  toolPartName,
} from "@/lib/agent/messages";
import { startAgentTurn } from "@/lib/agent/turn";
import {
  buildDerivedUserContext,
  combineAgentContexts,
} from "@/lib/agent-memory/derived-context";
import { AGENT_MEMORY_JOB_LEASE_MS } from "@/lib/agent-memory/jobs";
import { buildRetrievalQuery } from "@/lib/agent-memory/query-context";
import { retrieveMemoriesForChat } from "@/lib/agent-memory/retrieval";
import { findDeniedContent } from "@/lib/agent-memory/security";
import { consumeUIMessageStream } from "@/lib/background-agent/consume-stream";
import { connectDB } from "@/lib/mongodb";
import type { AgentRunSurface } from "@/lib/tools/types";
import type { IAgentMemoryJob } from "@/models/AgentMemoryJob";
import { AgentTask, type IAgentTask } from "@/models/AgentTask";
import {
  AgentTaskRun,
  type IAgentTaskRun,
  type IAgentTaskToolCall,
} from "@/models/AgentTaskRun";

const MAX_AUDIT_TEXT = 16_000;

type IAgentTaskRunUsage = NonNullable<IAgentTaskRun["tokenUsage"]>;

function boundedAuditValue(value: unknown): string {
  const serialized = JSON.stringify(value, (key, nested) =>
    key === "data" && typeof nested === "string" && nested.length > 1_000
      ? `[redacted binary: ${nested.length} chars]`
      : nested,
  );
  const safeValue =
    typeof value === "string" ? value : (serialized ?? String(value));
  if (findDeniedContent(safeValue).length > 0)
    return "[redacted: secret-like content]";
  return safeValue.slice(0, MAX_AUDIT_TEXT);
}

function safeAuditInput(input: Record<string, unknown>) {
  return findDeniedContent(input).length > 0 ? { redacted: true } : input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractRunState(
  messages: readonly AgentUIMessage[],
  isWriteCall: (toolName: string, input: unknown) => boolean = () => false,
) {
  const calls: IAgentTaskToolCall[] = [];
  let output = "";
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const text = messageText(message);
    if (text) output = text;
    for (const part of message.parts) {
      if (!isAgentToolPart(part) || part.providerExecuted) continue;
      const done = part.state === "output-available";
      const failed = part.state === "output-error";
      calls.push({
        toolUseId: part.toolCallId,
        name: toolPartName(part),
        isWrite: isWriteCall(toolPartName(part), part.input),
        input: safeAuditInput(isRecord(part.input) ? part.input : {}),
        ...(done
          ? { result: boundedAuditValue(toolOutputText(part.output)) }
          : failed
            ? { result: boundedAuditValue(part.errorText) }
            : {}),
        isError: failed,
      });
    }
  }
  return {
    output:
      findDeniedContent(output).length > 0
        ? "[redacted: secret-like content]"
        : output.slice(0, 64_000),
    toolCalls: calls,
  };
}

/**
 * A saved task run by hand is a different situation from the same task firing
 * on its cron — Deniz just asked for it — even though both execute unattended.
 */
function taskRunSurface(
  task: IAgentTask,
  trigger: "scheduled" | "manual",
): AgentRunSurface {
  if (trigger === "manual") return "manual-task-run";
  return task.schedule ? "scheduled-task" : "one-off-task";
}

function taskMessage(task: IAgentTask): AgentUIMessage {
  const parts: AgentUIMessagePart[] = task.attachments.map((attachment) => ({
    type: "file",
    mediaType: attachment.mimeType,
    url: attachment.url,
  }));
  parts.push({
    type: "text",
    text: [
      `Run the task "${task.name}" now, unattended.`,
      "",
      task.prompt,
      "",
      "Nobody is watching this run. Finish the work end to end rather than asking a question or describing what you would do, and close with a short report of what you actually changed and what you found.",
    ].join("\n"),
  });
  return {
    id: randomUUID(),
    role: "user",
    parts,
    metadata: { createdAt: new Date().toISOString() },
  };
}

export async function processAgentTaskJob(job: IAgentMemoryJob) {
  const runId =
    typeof job.checkpoint?.agentTaskRunId === "string"
      ? job.checkpoint.agentTaskRunId
      : "";
  const taskId =
    typeof job.checkpoint?.agentTaskId === "string"
      ? job.checkpoint.agentTaskId
      : "";
  await connectDB();
  const [run, task] = await Promise.all([
    AgentTaskRun.findById(runId),
    AgentTask.findById(taskId),
  ]);
  if (!run || !task) return { failed: true, reason: "agent-task-missing" };
  if (["completed", "failed"].includes(run.status)) {
    return { skipped: true, runId: run._id.toString() };
  }

  const now = new Date();
  if (run.status === "running") {
    const staleBefore = now.getTime() - AGENT_MEMORY_JOB_LEASE_MS;
    if (run.startedAt && run.startedAt.getTime() > staleBefore) {
      return { skipped: true, runId: run._id.toString() };
    }
    run.status = "failed";
    run.error =
      "Unattended run was interrupted after execution began; review partial side effects before running it again.";
    run.completedAt = now;
    await run.save();
    return { failed: true, runId: run._id.toString(), error: run.error };
  }

  run.status = "running";
  run.startedAt = now;
  run.error = undefined;
  await run.save();

  let finalMessages: AgentUIMessage[] = [];
  let isWriteCall: (toolName: string, input: unknown) => boolean = () => false;
  let tokenUsage: IAgentTaskRunUsage | undefined;
  try {
    const query = buildRetrievalQuery({ latestMessage: task.prompt });
    // `incognito` reads nothing and writes nothing; `retrieval-off` still keeps
    // the derived user model, it just skips episodic recall.
    const [retrieval, learnedContext] = await Promise.all([
      task.memoryMode === "enabled"
        ? retrieveMemoriesForChat({
            requestId: randomUUID(),
            query,
            memoryMode: task.memoryMode,
          }).catch(() => null)
        : null,
      task.memoryMode === "incognito"
        ? null
        : buildDerivedUserContext({
            query,
            maxTokens: 800,
            maxProfileItems: 8,
          }).catch(() => null),
    ]);
    const stream = await startAgentTurn({
      purpose: "agent-task",
      source: `agent-task:${task._id.toString()}:${run._id.toString()}`,
      model: task.llmModel,
      surface: taskRunSurface(task, run.trigger),
      unattended: true,
      executionMode: "yolo",
      memoryMode: task.memoryMode,
      messages: [taskMessage(task)],
      toolToggles: { webSearch: false, webFetch: false, thinkLonger: false },
      maxRounds: task.maxRounds,
      pageTools: false,
      task: {
        id: task._id.toString(),
        runId: run._id.toString(),
        name: task.name,
        origin: task.origin,
        ...(task.schedule
          ? { cron: task.schedule.cron, timeZone: task.schedule.timeZone }
          : {}),
        ...(task.runAt ? { runAt: task.runAt.toISOString() } : {}),
      },
      memory: {
        context: combineAgentContexts(
          learnedContext?.context ?? null,
          retrieval?.context ?? null,
        ),
        images: retrieval?.images ?? [],
        ...(retrieval
          ? { traceId: retrieval.traceId, injected: retrieval.injected }
          : { injected: false }),
      },
      onFinish: async ({
        messages,
        responseMessage,
        isWriteCall: classify,
      }) => {
        finalMessages = messages;
        isWriteCall = classify;
        const usage = responseMessage.metadata?.usage;
        if (usage) {
          tokenUsage = {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: usage.costUsd,
          };
        }
      },
    });
    await consumeUIMessageStream(stream);
    const state = extractRunState(finalMessages, isWriteCall);
    run.status = "completed";
    run.output = state.output || "Task completed without a text response.";
    run.toolCalls = state.toolCalls;
    run.tokenUsage = tokenUsage;
    run.completedAt = new Date();
    await run.save();
    return {
      runId: run._id.toString(),
      status: run.status,
      toolsExecuted: state.toolCalls.length,
    };
  } catch (error) {
    const partialState = extractRunState(finalMessages, isWriteCall);
    run.status = "failed";
    if (partialState.output) run.output = partialState.output;
    run.toolCalls = partialState.toolCalls;
    run.tokenUsage = tokenUsage;
    run.error =
      error instanceof Error
        ? error.message.slice(0, 4_096)
        : "Agent run failed";
    run.completedAt = new Date();
    await run.save();
    // Do not throw: a full-run retry could duplicate already-completed writes.
    return { runId: run._id.toString(), failed: true, error: run.error };
  }
}
