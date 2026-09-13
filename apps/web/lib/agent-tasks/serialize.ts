import type {
  AgentUIMessage,
  AgentTaskRun as SerializedRun,
  AgentTaskRunSummary as SerializedRunSummary,
  AgentTask as SerializedTask,
} from "@repo/schemas";
import { isAgentUIMessage } from "@/lib/agent/messages";
import type { IAgentTask } from "@/models/AgentTask";
import type {
  IAgentTaskLegacyToolCall,
  IAgentTaskRun,
} from "@/models/AgentTaskRun";

const OUTPUT_PREVIEW_CHARS = 400;

function hasCompleteTokenUsage(
  tokenUsage: IAgentTaskRun["tokenUsage"],
): tokenUsage is NonNullable<IAgentTaskRun["tokenUsage"]> {
  return (
    typeof tokenUsage?.inputTokens === "number" &&
    Number.isFinite(tokenUsage.inputTokens) &&
    typeof tokenUsage.outputTokens === "number" &&
    Number.isFinite(tokenUsage.outputTokens) &&
    typeof tokenUsage.costUsd === "number" &&
    Number.isFinite(tokenUsage.costUsd)
  );
}

export function serializeAgentTask(task: IAgentTask): SerializedTask {
  return {
    id: task._id.toString(),
    name: task.name,
    prompt: task.prompt,
    attachments: task.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
    schedule: task.schedule
      ? { cron: task.schedule.cron, timeZone: task.schedule.timeZone }
      : null,
    runAt: task.runAt ? task.runAt.toISOString() : null,
    origin: task.origin ?? "owner",
    model: task.llmModel,
    memoryMode: task.memoryMode,
    status: task.status,
    ...(task.nextRunAt ? { nextRunAt: task.nextRunAt.toISOString() } : {}),
    ...(task.lastRunAt ? { lastRunAt: task.lastRunAt.toISOString() } : {}),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

/**
 * A run written before transcripts were kept has only the flattened audit
 * rows. Rebuilt here as one assistant message of finished tool parts followed
 * by the closing text, so the UI never needs a second renderer for old runs.
 */
function legacyTranscript(
  run: Pick<IAgentTaskRun, "_id" | "output" | "toolCalls" | "startedAt">,
): AgentUIMessage[] {
  const calls = run.toolCalls ?? [];
  if (calls.length === 0 && !run.output) return [];
  const id = `${run._id.toString()}:legacy`;
  const parts: AgentUIMessage["parts"] = calls.map(
    (call: IAgentTaskLegacyToolCall) =>
      call.isError
        ? {
            type: "dynamic-tool",
            toolName: call.name,
            toolCallId: call.toolUseId,
            state: "output-error",
            input: call.input,
            errorText: call.result ?? "Tool call failed",
          }
        : {
            type: "dynamic-tool",
            toolName: call.name,
            toolCallId: call.toolUseId,
            state: "output-available",
            input: call.input,
            output: call.result ?? "",
          },
  );
  if (run.output) parts.push({ type: "text", text: run.output });
  return [
    {
      id,
      role: "assistant",
      parts,
      ...(run.startedAt
        ? { metadata: { createdAt: run.startedAt.toISOString() } }
        : {}),
    },
  ];
}

function runMessages(run: IAgentTaskRun): AgentUIMessage[] {
  const stored = run.messages.filter(isAgentUIMessage);
  return stored.length > 0 ? stored : legacyTranscript(run);
}

function countToolCalls(run: IAgentTaskRun): number {
  if (typeof run.toolCallCount === "number" && run.toolCallCount > 0) {
    return run.toolCallCount;
  }
  return run.toolCalls?.length ?? 0;
}

function outputPreview(output: string | undefined): string | undefined {
  if (!output) return undefined;
  const firstParagraph = output.trim().split(/\n\s*\n/, 1)[0] ?? "";
  const line = firstParagraph.replace(/\s+/g, " ").trim();
  return line.length > OUTPUT_PREVIEW_CHARS
    ? `${line.slice(0, OUTPUT_PREVIEW_CHARS - 1)}…`
    : line;
}

function serializeRunFields(
  run: IAgentTaskRun,
): Omit<SerializedRunSummary, "outputPreview" | "toolCalls"> {
  return {
    id: run._id.toString(),
    taskId: run.taskId.toString(),
    taskName: run.taskName,
    trigger: run.trigger,
    status: run.status,
    scheduledFor: run.scheduledFor.toISOString(),
    ...(run.startedAt ? { startedAt: run.startedAt.toISOString() } : {}),
    ...(run.completedAt ? { completedAt: run.completedAt.toISOString() } : {}),
    ...(hasCompleteTokenUsage(run.tokenUsage)
      ? {
          tokenUsage: {
            inputTokens: run.tokenUsage.inputTokens,
            outputTokens: run.tokenUsage.outputTokens,
            costUsd: run.tokenUsage.costUsd,
          },
        }
      : {}),
    ...(run.feedback
      ? {
          feedback: {
            feedbackId: run.feedback.feedbackId,
            verdict: run.feedback.verdict,
            ...(run.feedback.text ? { text: run.feedback.text } : {}),
            learnedProcedureIds: run.feedback.learnedProcedureIds.map(String),
            createdAt: run.feedback.createdAt.toISOString(),
          },
        }
      : {}),
    ...(run.error ? { error: run.error } : {}),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

/** The list row. Reads nothing from `messages`, so a query may project it away. */
export function serializeAgentTaskRunSummary(
  run: IAgentTaskRun,
): SerializedRunSummary {
  const preview = outputPreview(run.output);
  return {
    ...serializeRunFields(run),
    ...(preview ? { outputPreview: preview } : {}),
    toolCalls: countToolCalls(run),
  };
}

export function serializeAgentTaskRun(run: IAgentTaskRun): SerializedRun {
  return {
    ...serializeRunFields(run),
    ...(run.output ? { output: run.output } : {}),
    messages: runMessages(run),
  };
}
