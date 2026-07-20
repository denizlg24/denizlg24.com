import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import {
  buildDerivedUserContext,
  combineAgentContexts,
} from "@/lib/agent-memory/derived-context";
import { buildRetrievalQuery } from "@/lib/agent-memory/query-context";
import { retrieveMemoriesForChat } from "@/lib/agent-memory/retrieval";
import { findDeniedContent } from "@/lib/agent-memory/security";
import { streamAgent } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { getAppTimeZone } from "@/lib/timezone";
import { getToolSchemas, isWriteTool } from "@/lib/tools/registry";
import { buildSystemPrompt } from "@/lib/tools/system-prompt";
import type { IAgentMemoryJob } from "@/models/AgentMemoryJob";
import {
  AgentTrainingRun,
  type IAgentTrainingToolCall,
} from "@/models/AgentTrainingRun";
import type { IAgentTrainingTask } from "@/models/AgentTrainingTask";
import { AgentTrainingTask } from "@/models/AgentTrainingTask";

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
  const calls = new Map<string, IAgentTrainingToolCall>();
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

function taskContent(task: IAgentTrainingTask): Anthropic.ContentBlockParam[] {
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
    text: `Execute this recurring training task now.\n\n${task.prompt}`,
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
        error = "YOLO training run paused unexpectedly";
      }
    }
  }
  if (error) throw new Error(error);
}

export async function processTrainingJob(job: IAgentMemoryJob) {
  const runId =
    typeof job.checkpoint?.trainingRunId === "string"
      ? job.checkpoint.trainingRunId
      : "";
  const taskId =
    typeof job.checkpoint?.trainingTaskId === "string"
      ? job.checkpoint.trainingTaskId
      : "";
  await connectDB();
  const [run, task] = await Promise.all([
    AgentTrainingRun.findById(runId),
    AgentTrainingTask.findById(taskId),
  ]);
  if (!run || !task) return { failed: true, reason: "training-record-missing" };
  if (["awaiting-feedback", "learning", "completed"].includes(run.status)) {
    return { skipped: true, runId: run._id.toString() };
  }

  run.status = "running";
  run.startedAt = new Date();
  run.error = undefined;
  await run.save();

  let finalMessages: Anthropic.MessageParam[] = [];
  let tokenUsage:
    | { inputTokens: number; outputTokens: number; costUsd: number }
    | undefined;
  try {
    const query = buildRetrievalQuery({ latestMessage: task.prompt });
    const [retrieval, learnedContext] = await Promise.all([
      retrieveMemoriesForChat({
        requestId: randomUUID(),
        query,
        memoryMode: "enabled",
      }).catch(() => null),
      buildDerivedUserContext({
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
      { executionMode: "yolo" },
    );
    const tools = getToolSchemas().map((schema) => ({
      name: schema.name,
      description: schema.description,
      input_schema: schema.input_schema,
    }));
    const stream = await streamAgent({
      purpose: "agent-training",
      source: `agent-training:${task._id.toString()}:${run._id.toString()}`,
      model: task.llmModel,
      system,
      logSystemPrompt: buildSystemPrompt(timeZone, null, {
        executionMode: "yolo",
      }),
      messages: [{ role: "user", content: taskContent(task) }],
      tools,
      executionMode: "yolo",
      requireTools: true,
      onPersist: async (messages, usage) => {
        finalMessages = structuredClone(messages);
        if (usage) tokenUsage = usage;
      },
    });
    await consumeAgentStream(stream);
    const state = extractRunState(finalMessages);
    run.status = "awaiting-feedback";
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
