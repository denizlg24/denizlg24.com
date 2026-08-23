import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import {
  buildDerivedUserContext,
  combineAgentContexts,
} from "@/lib/agent-memory/derived-context";
import { AGENT_MEMORY_JOB_LEASE_MS } from "@/lib/agent-memory/jobs";
import { buildRetrievalQuery } from "@/lib/agent-memory/query-context";
import { retrieveMemoriesForChat } from "@/lib/agent-memory/retrieval";
import { findDeniedContent } from "@/lib/agent-memory/security";
import { streamAgent } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { getAppTimeZone } from "@/lib/timezone";
import {
  getToolSchemas,
  isClientTool,
  isWriteTool,
} from "@/lib/tools/registry";
import { buildSystemPrompt } from "@/lib/tools/system-prompt";
import type { AgentRunSurface } from "@/lib/tools/types";
import type { IAgentMemoryJob } from "@/models/AgentMemoryJob";
import { AgentTask, type IAgentTask } from "@/models/AgentTask";
import { AgentTaskRun, type IAgentTaskToolCall } from "@/models/AgentTaskRun";

const MAX_AUDIT_TEXT = 16_000;

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

function extractRunState(messages: Anthropic.MessageParam[]) {
  const calls = new Map<string, IAgentTaskToolCall>();
  let output = "";
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    if (message.role === "assistant") {
      const text = message.content
        .filter(
          (block): block is Anthropic.TextBlockParam => block.type === "text",
        )
        .map((block) => block.text)
        .join("");
      if (text) output = text;
      for (const block of message.content) {
        if (block.type !== "tool_use") continue;
        calls.set(block.id, {
          toolUseId: block.id,
          name: block.name,
          isWrite: isWriteTool(block.name),
          input: safeAuditInput(block.input as Record<string, unknown>),
          isError: false,
        });
      }
      continue;
    }
    for (const block of message.content) {
      if (block.type !== "tool_result") continue;
      const call = calls.get(block.tool_use_id);
      if (!call) continue;
      call.result = boundedAuditValue(block.content);
      call.isError = block.is_error === true;
    }
  }
  return {
    output:
      findDeniedContent(output).length > 0
        ? "[redacted: secret-like content]"
        : output.slice(0, 64_000),
    toolCalls: [...calls.values()],
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

function taskContent(task: IAgentTask): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const attachment of task.attachments) {
    if (attachment.mimeType.startsWith("image/")) {
      content.push({
        type: "image",
        source: { type: "url", url: attachment.url },
      });
    } else {
      content.push({
        type: "document",
        source: { type: "url", url: attachment.url },
      });
    }
  }
  content.push({
    type: "text",
    text: [
      `Run the task "${task.name}" now, unattended.`,
      "",
      task.prompt,
      "",
      "Nobody is watching this run. Finish the work end to end rather than asking a question or describing what you would do, and close with a short report of what you actually changed and what you found.",
    ].join("\n"),
  });
  return content;
}

async function consumeAgentStream(stream: ReadableStream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let error: string | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame
        .split("\n")
        .find((candidate) => candidate.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as {
        type?: string;
        error?: string;
      };
      if (event.type === "error") error = event.error ?? "Agent run failed";
      if (event.type === "paused") {
        error = "Unattended run paused unexpectedly";
      }
    }
  }
  if (error) throw new Error(error);
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

  let finalMessages: Anthropic.MessageParam[] = [];
  let tokenUsage:
    | { inputTokens: number; outputTokens: number; costUsd: number }
    | undefined;
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
    const timeZone = await getAppTimeZone();
    const system = buildSystemPrompt(
      timeZone,
      combineAgentContexts(
        learnedContext?.context ?? null,
        retrieval?.context ?? null,
      ),
      { executionMode: "yolo", clientToolsAvailable: false },
    );
    const tools = getToolSchemas()
      .filter((schema) => !isClientTool(schema.name))
      .map((schema) => ({
        name: schema.name,
        description: schema.description,
        input_schema: schema.input_schema,
      }));
    const stream = await streamAgent({
      purpose: "agent-task",
      source: `agent-task:${task._id.toString()}:${run._id.toString()}`,
      model: task.llmModel,
      system,
      logSystemPrompt: buildSystemPrompt(timeZone, null, {
        executionMode: "yolo",
        clientToolsAvailable: false,
      }),
      messages: [{ role: "user", content: taskContent(task) }],
      tools,
      toolContext: {
        memoryMode: task.memoryMode,
        run: {
          surface: taskRunSurface(task, run.trigger),
          unattended: true,
          executionMode: "yolo",
          clientToolsAvailable: false,
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
        },
      },
      executionMode: "yolo",
      maxIterations: task.maxRounds,
      requireTools: true,
      onPersist: async (messages, usage) => {
        finalMessages = structuredClone(messages);
        if (usage) tokenUsage = usage;
      },
    });
    await consumeAgentStream(stream);
    const state = extractRunState(finalMessages);
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
    const partialState = extractRunState(finalMessages);
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
