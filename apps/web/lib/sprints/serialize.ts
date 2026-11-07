import {
  type CodingRun,
  type CodingRunSummary,
  codingRunCiSchema,
  codingRunUsageSchema,
  type RunResult,
  runConfigOverrideSchema,
  runResultSchema,
  type Sprint,
  type SprintSlot,
} from "@repo/schemas";
import { resolveRunConfig } from "@repo/utils/sprints";
import { isAgentUIMessage } from "@/lib/agent/messages";
import type { ICodingRun } from "@/models/CodingRun";
import type { ISprint } from "@/models/Sprint";
import type { ISprintSlot } from "@/models/SprintSlot";

export function serializeSprint(sprint: ISprint): Sprint {
  const release = sprint.release;
  return {
    id: sprint._id.toString(),
    title: sprint.title,
    goal: sprint.goal,
    repo: sprint.repo,
    baseBranch: sprint.baseBranch,
    branch: sprint.branch,
    defaults: resolveRunConfig({}, sprint.defaults),
    ...(sprint.prNumber ? { prNumber: sprint.prNumber } : {}),
    ...(sprint.prUrl ? { prUrl: sprint.prUrl } : {}),
    ...(sprint.prState ? { prState: sprint.prState } : {}),
    ...(release
      ? {
          release: {
            runId: release.runId,
            sha: release.sha,
            readyAt: release.readyAt.toISOString(),
            state: release.state,
            ...(release.mergedAt
              ? { mergedAt: release.mergedAt.toISOString() }
              : {}),
            ...(release.mergeSha ? { mergeSha: release.mergeSha } : {}),
            ...(release.error ? { error: release.error } : {}),
          },
        }
      : {}),
    status: sprint.status,
    timeZone: sprint.timeZone,
    branchLocked: sprint.branchLocked,
    createdAt: sprint.createdAt.toISOString(),
    updatedAt: sprint.updatedAt.toISOString(),
  };
}

export function serializeSlot(slot: ISprintSlot): SprintSlot {
  const config = runConfigOverrideSchema.safeParse(slot.config ?? {});
  return {
    id: slot._id.toString(),
    sprintId: slot.sprintId.toString(),
    at: slot.at.toISOString(),
    kind: slot.kind,
    title: slot.title,
    task: slot.task,
    config: config.success ? config.data : {},
    dependsOn: [...slot.dependsOn],
    onUpstreamRunning: { waitMinutes: slot.onUpstreamRunning.waitMinutes },
    status: slot.status,
    ...(slot.skipReason ? { skipReason: slot.skipReason } : {}),
    ...(slot.lastRunId ? { lastRunId: slot.lastRunId.toString() } : {}),
    order: slot.order,
    createdAt: slot.createdAt.toISOString(),
    updatedAt: slot.updatedAt.toISOString(),
  };
}

export function storedRunResult(value: unknown): RunResult | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = runResultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Reads nothing from `messages`, so a query may project it away. */
export function serializeRunSummary(run: ICodingRun): CodingRunSummary {
  const usage = run.usage ? codingRunUsageSchema.safeParse(run.usage) : null;
  const ci = run.ci
    ? codingRunCiSchema.safeParse({
        ...run.ci,
        checkedAt:
          run.ci.checkedAt instanceof Date
            ? run.ci.checkedAt.toISOString()
            : run.ci.checkedAt,
      })
    : null;
  return {
    id: run._id.toString(),
    sprintId: run.sprintId.toString(),
    slotId: run.slotId.toString(),
    kind: run.kind,
    status: run.status,
    ...(run.failure
      ? { failure: { code: run.failure.code, message: run.failure.message } }
      : {}),
    repo: run.repo,
    branch: run.branch,
    ...(run.baseSha ? { baseSha: run.baseSha } : {}),
    ...(run.headSha ? { headSha: run.headSha } : {}),
    ...(usage?.success ? { usage: usage.data } : {}),
    ...(ci?.success ? { ci: ci.data } : {}),
    ...(run.prUrl ? { prUrl: run.prUrl } : {}),
    ...(run.startedAt ? { startedAt: run.startedAt.toISOString() } : {}),
    ...(run.completedAt ? { completedAt: run.completedAt.toISOString() } : {}),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

export function serializeRun(run: ICodingRun): CodingRun {
  const result = storedRunResult(run.result);
  return {
    ...serializeRunSummary(run),
    config: resolveRunConfig({}, run.config),
    ...(result ? { result } : {}),
    cancelRequested: run.cancelRequested,
    messages: run.messages.filter(isAgentUIMessage),
    ...(run.workspacePath ? { workspacePath: run.workspacePath } : {}),
    ...(run.runnerVersion ? { runnerVersion: run.runnerVersion } : {}),
    ...(run.harnessVersion ? { harnessVersion: run.harnessVersion } : {}),
  };
}
