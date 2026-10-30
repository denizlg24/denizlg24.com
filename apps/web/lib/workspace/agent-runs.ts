import type { ButtonAgentRun } from "@repo/schemas";
import { after } from "next/server";
import {
  drainOneBackgroundAgentJob,
  enqueueBackgroundAgentRun,
} from "@/lib/background-agent/execution";
import { getUnattendedModel } from "@/lib/llm-service";
import type { IBackgroundAgentRun } from "@/models/BackgroundAgentRun";

/*
 * Agent runs a workflow starts — a button's prompt, a trigger's — are
 * ordinary background runs: a conversation of their own, executed at once
 * and visible in the agent's run list. They are incognito: what they read and
 * say is not the owner's own, so none of it becomes memory evidence, and they
 * cannot write memories. Their workspace edits are attributed to their
 * conversation (`conversation:<id>`) like any background run's.
 */

export interface WorkflowAgentRunInput {
  prompt: string;
  /** The page the run is about: the agent sees it (id, rev, markdown) as page context. */
  page?: { id: string; title: string };
}

export async function startWorkflowAgentRun(
  input: WorkflowAgentRunInput,
): Promise<IBackgroundAgentRun> {
  const run = await enqueueBackgroundAgentRun(
    {
      prompt: input.prompt,
      model: await getUnattendedModel(),
      attachments: [],
      ...(input.page
        ? {
            pageContext: {
              pathname: "/dashboard/page",
              ...(input.page.title ? { title: input.page.title } : {}),
              workspacePageId: input.page.id,
            },
          }
        : {}),
    },
    { memoryMode: "incognito" },
  );
  drainSoon(run._id.toString());
  return run;
}

/** Runs the job now, after the response, instead of waiting for the external cron. */
function drainSoon(runId: string) {
  const drain = () =>
    drainOneBackgroundAgentJob(runId).catch((error) => {
      console.error("[Workflows] Immediate agent run failed", error);
    });
  try {
    after(drain);
  } catch {
    void drain();
  }
}

export function buttonAgentRunOf(run: IBackgroundAgentRun): ButtonAgentRun {
  return {
    runId: run._id.toString(),
    conversationId: run.conversationId.toString(),
    status: run.status,
    startedAt: (run.startedAt ?? run.createdAt).toISOString(),
    ...(run.completedAt ? { completedAt: run.completedAt.toISOString() } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}
