import type {
  AgentTaskRun as SerializedRun,
  AgentTask as SerializedTask,
} from "@repo/schemas";
import type { IAgentTask } from "@/models/AgentTask";
import type { IAgentTaskRun } from "@/models/AgentTaskRun";

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
    maxRounds: task.maxRounds,
    ...(task.nextRunAt ? { nextRunAt: task.nextRunAt.toISOString() } : {}),
    ...(task.lastRunAt ? { lastRunAt: task.lastRunAt.toISOString() } : {}),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function serializeAgentTaskRun(run: IAgentTaskRun): SerializedRun {
  return {
    id: run._id.toString(),
    taskId: run.taskId.toString(),
    taskName: run.taskName,
    trigger: run.trigger,
    status: run.status,
    scheduledFor: run.scheduledFor.toISOString(),
    ...(run.startedAt ? { startedAt: run.startedAt.toISOString() } : {}),
    ...(run.completedAt ? { completedAt: run.completedAt.toISOString() } : {}),
    ...(run.output ? { output: run.output } : {}),
    toolCalls: run.toolCalls.map((call) => ({
      toolUseId: call.toolUseId,
      name: call.name,
      isWrite: call.isWrite,
      input: call.input,
      ...(call.result ? { result: call.result } : {}),
      isError: call.isError,
    })),
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
