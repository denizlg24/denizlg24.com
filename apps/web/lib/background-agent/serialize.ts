import type { BackgroundAgentRun as SerializedRun } from "@repo/schemas";
import type { IBackgroundAgentRun } from "@/models/BackgroundAgentRun";

export function serializeBackgroundAgentRun(
  run: IBackgroundAgentRun,
): SerializedRun {
  return {
    id: run._id.toString(),
    conversationId: run.conversationId.toString(),
    prompt: run.prompt,
    model: run.llmModel,
    ...(run.pageContext ? { pageContext: run.pageContext } : {}),
    attachments: run.attachments.map((attachment) => ({
      type: attachment.type,
      url: attachment.url,
      name: attachment.name,
    })),
    status: run.status,
    ...(run.output ? { output: run.output } : {}),
    ...(run.tokenUsage
      ? {
          tokenUsage: {
            inputTokens: run.tokenUsage.inputTokens,
            outputTokens: run.tokenUsage.outputTokens,
            costUsd: run.tokenUsage.costUsd,
          },
        }
      : {}),
    ...(run.error ? { error: run.error } : {}),
    ...(run.startedAt ? { startedAt: run.startedAt.toISOString() } : {}),
    ...(run.completedAt ? { completedAt: run.completedAt.toISOString() } : {}),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}
