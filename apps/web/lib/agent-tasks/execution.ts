import { randomUUID } from "node:crypto";
import type { AgentUIMessage, AgentUIMessagePart } from "@repo/schemas";
import { readUIMessageStream, type UIMessageChunk } from "ai";
import { sanitizeMessagesForStorage } from "@/lib/agent/evidence-units";
import {
  isAgentToolPart,
  messageText,
  toolOutputText,
} from "@/lib/agent/messages";
import { startAgentTurn } from "@/lib/agent/turn";
import {
  buildDerivedUserContext,
  combineAgentContexts,
} from "@/lib/agent-memory/derived-context";
import {
  AGENT_MEMORY_JOB_LEASE_MS,
  withMemoryJobHeartbeat,
} from "@/lib/agent-memory/jobs";
import { buildRetrievalQuery } from "@/lib/agent-memory/query-context";
import { retrieveMemoriesForChat } from "@/lib/agent-memory/retrieval";
import { findDeniedContent } from "@/lib/agent-memory/security";
import { consumeUIMessageStream } from "@/lib/background-agent/consume-stream";
import { connectDB } from "@/lib/mongodb";
import type { AgentRunSurface } from "@/lib/tools/types";
import type { IAgentMemoryJob } from "@/models/AgentMemoryJob";
import { AgentTask, type IAgentTask } from "@/models/AgentTask";
import { AgentTaskRun, type IAgentTaskRun } from "@/models/AgentTaskRun";

const MAX_AUDIT_TEXT = 16_000;
const MAX_OUTPUT_TEXT = 64_000;
const REDACTED = "[redacted: secret-like content]";
/** How often a running transcript reaches the row, so the page can watch it. */
const PERSIST_INTERVAL_MS = 2_000;

type IAgentTaskRunUsage = NonNullable<IAgentTaskRun["tokenUsage"]>;

function redactText(text: string): string {
  return findDeniedContent(text).length > 0 ? REDACTED : text;
}

/**
 * A tool output keeps its shape — the renderer reads connector content blocks
 * out of it — unless it is oversized or secret-like, in which case the text is
 * what survives. Connector results are already cut at 48k characters upstream;
 * the bound here is what keeps a long unattended run under Mongo's document
 * limit.
 */
function auditedToolOutput(output: unknown): unknown {
  const text = toolOutputText(output);
  if (findDeniedContent(text).length > 0) return REDACTED;
  if (text.length <= MAX_AUDIT_TEXT) return output;
  return `${text.slice(0, MAX_AUDIT_TEXT)}\n[cut: ${text.length} chars]`;
}

function auditedPart(part: AgentUIMessagePart): AgentUIMessagePart {
  if (part.type === "text" || part.type === "reasoning") {
    return { ...part, text: redactText(part.text) };
  }
  if (!isAgentToolPart(part)) return part;
  const input =
    findDeniedContent(part.input).length > 0 ? { redacted: true } : part.input;
  if (part.state === "output-available") {
    return { ...part, input, output: auditedToolOutput(part.output) };
  }
  if (part.state === "output-error") {
    return { ...part, input, errorText: redactText(part.errorText) };
  }
  return { ...part, input };
}

/** What the run row keeps: the chat's storage form plus the audit bounds. */
function transcriptForStorage(
  messages: readonly AgentUIMessage[],
): AgentUIMessage[] {
  return sanitizeMessagesForStorage(messages).map((message) => ({
    ...message,
    parts: message.parts.map(auditedPart),
  }));
}

function countToolCalls(messages: readonly AgentUIMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (isAgentToolPart(part) && !part.providerExecuted) count += 1;
    }
  }
  return count;
}

function closingText(messages: readonly AgentUIMessage[]): string {
  let output = "";
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const text = messageText(message);
    if (text) output = text;
  }
  return redactText(output).slice(0, MAX_OUTPUT_TEXT);
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

  if (!job.leaseOwner) {
    throw new Error("Agent task job is missing an execution lease");
  }
  const now = new Date();
  if (run.status === "running") {
    // Its worker is alive as long as the lease it keeps pushing forward has
    // not lapsed; a row from before leases falls back to its start time.
    const deadline =
      run.executionLeaseExpiresAt ??
      (run.startedAt
        ? new Date(run.startedAt.getTime() + AGENT_MEMORY_JOB_LEASE_MS)
        : null);
    if (deadline && deadline > now) {
      return { skipped: true, runId: run._id.toString() };
    }
    run.status = "failed";
    run.error =
      "Unattended run was interrupted after execution began; review partial side effects before running it again.";
    run.completedAt = now;
    run.executionLeaseExpiresAt = undefined;
    await run.save();
    return { failed: true, runId: run._id.toString(), error: run.error };
  }

  const request = taskMessage(task);
  run.status = "running";
  run.startedAt = now;
  run.executionLeaseExpiresAt =
    job.leaseExpiresAt && job.leaseExpiresAt > now
      ? job.leaseExpiresAt
      : new Date(now.getTime() + AGENT_MEMORY_JOB_LEASE_MS);
  run.error = undefined;
  run.messages = [request];
  run.toolCallCount = 0;
  await run.save();

  // The transcript as last seen, whichever way the turn ends: `onFinish`
  // hands over the final one, and the watcher keeps the latest snapshot for a
  // stream that dies before that.
  let transcript: AgentUIMessage[] = [request];
  let tokenUsage: IAgentTaskRunUsage | undefined;

  const persist = async (messages: readonly AgentUIMessage[]) => {
    await AgentTaskRun.updateOne(
      { _id: run._id },
      {
        $set: {
          messages: transcriptForStorage(messages),
          toolCallCount: countToolCalls(messages),
        },
      },
    );
  };

  const watch = async (snapshots: ReadableStream<UIMessageChunk>) => {
    let lastPersistedAt = 0;
    let pending: AgentUIMessage[] | null = null;
    for await (const response of readUIMessageStream<AgentUIMessage>({
      stream: snapshots,
    })) {
      transcript = [request, response];
      pending = transcript;
      if (Date.now() - lastPersistedAt < PERSIST_INTERVAL_MS) continue;
      lastPersistedAt = Date.now();
      pending = null;
      await persist(transcript).catch(() => undefined);
    }
    if (pending) await persist(pending).catch(() => undefined);
  };

  const heartbeat = {
    jobId: job._id.toString(),
    workerId: job.leaseOwner,
    onBeat: async (leaseExpiresAt: Date) => {
      await AgentTaskRun.updateOne(
        { _id: run._id, status: "running" },
        { $set: { executionLeaseExpiresAt: leaseExpiresAt } },
      );
    },
  };

  return withMemoryJobHeartbeat(heartbeat, async () => {
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
        messages: [request],
        toolToggles: { webSearch: false, webFetch: false, thinkLonger: false },
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
        onFinish: async ({ messages, responseMessage }) => {
          transcript = messages;
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
      // One branch is the audit read that turns a stream error or an approval
      // request into a thrown one; the other rebuilds the message as it grows.
      // Both are waited on so a late snapshot cannot land after the final save.
      const [audit, snapshots] = stream.tee();
      const [audited, watched] = await Promise.allSettled([
        consumeUIMessageStream(audit),
        watch(snapshots),
      ]);
      if (audited.status === "rejected") throw audited.reason;
      if (watched.status === "rejected") throw watched.reason;
      run.status = "completed";
      run.output =
        closingText(transcript) || "Task completed without a text response.";
      run.messages = transcriptForStorage(transcript);
      run.toolCallCount = countToolCalls(transcript);
      run.tokenUsage = tokenUsage;
      run.completedAt = new Date();
      run.executionLeaseExpiresAt = undefined;
      await run.save();
      return {
        runId: run._id.toString(),
        status: run.status,
        toolsExecuted: run.toolCallCount,
      };
    } catch (error) {
      run.status = "failed";
      const partialOutput = closingText(transcript);
      if (partialOutput) run.output = partialOutput;
      run.messages = transcriptForStorage(transcript);
      run.toolCallCount = countToolCalls(transcript);
      run.tokenUsage = tokenUsage;
      run.error =
        error instanceof Error
          ? error.message.slice(0, 4_096)
          : "Agent run failed";
      run.completedAt = new Date();
      run.executionLeaseExpiresAt = undefined;
      await run.save();
      // Do not throw: a full-run retry could duplicate already-completed writes.
      return { runId: run._id.toString(), failed: true, error: run.error };
    }
  });
}
