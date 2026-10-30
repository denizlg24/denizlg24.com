import type {
  ButtonAgentRun,
  ButtonRunRequest,
  ButtonRunResponse,
} from "@repo/schemas";
import { templateClock } from "@repo/utils/workspace-templates";
import { findBlock } from "@repo/utils/workspace-tree";
import { connectDB } from "@/lib/mongodb";
import { getAppTimeZone } from "@/lib/timezone";
import { BackgroundAgentRun } from "@/models/BackgroundAgentRun";
import { WorkspaceButtonRunModel } from "@/models/WorkspaceButtonRun";
import { runWorkflowActions } from "./actions";
import { buttonAgentRunOf, startWorkflowAgentRun } from "./agent-runs";
import { workspaceService } from "./index";
import { type WorkspaceCaller, WorkspaceError } from "./service";
import { workflowActionDeps } from "./workflow-deps";

function agentPrompt(prompt: string, title: string): string {
  return [
    prompt.trim(),
    "",
    `This run was started from a button on the workspace page "${title || "Untitled"}", which is in your context with its rev. Change that page with web_workspace_blocks against that rev; finish the work rather than asking.`,
  ].join("\n");
}

/**
 * Presses a button block. A locked page's button still runs: locking guards
 * the page's layout, not what its buttons do. Whatever the actions write is
 * written as `caller`.
 */
export async function pressButton(
  request: ButtonRunRequest,
  caller: WorkspaceCaller,
): Promise<ButtonRunResponse> {
  const page = await workspaceService.getPage(request.pageId);
  const block = findBlock(page.blocks, request.blockId)?.block;
  if (block?.type !== "button") {
    throw new WorkspaceError(
      404,
      "NOT_BUTTON",
      `No button ${request.blockId} on page ${request.pageId}`,
    );
  }
  if (block.mode === "agent") {
    if (!block.agentPrompt.trim()) {
      throw new WorkspaceError(400, "NO_PROMPT", "The button has no prompt");
    }
    const run = await startWorkflowAgentRun({
      prompt: agentPrompt(block.agentPrompt, page.title),
      page: { id: page.id, title: page.title },
    });
    await WorkspaceButtonRunModel.create({
      pageId: page.id,
      blockId: block.id,
      runId: run._id,
      conversationId: run.conversationId,
      createdAt: new Date(),
    });
    return { mode: "agent", run: buttonAgentRunOf(run) };
  }
  const timeZone = await getAppTimeZone();
  const results = await runWorkflowActions(
    block.actions,
    {
      host: { pageId: page.id, blockId: block.id },
      caller,
      clock: templateClock(new Date(), timeZone),
      timeZone,
      interactive: !caller.agent,
    },
    workflowActionDeps(timeZone),
  );
  return { mode: "actions", results };
}

/** The last agent run a button started, as it stands now. */
export async function lastButtonRun(
  pageId: string,
  blockId: string,
): Promise<ButtonAgentRun | null> {
  await connectDB();
  const pointer = await WorkspaceButtonRunModel.findOne({ pageId, blockId })
    .sort({ createdAt: -1 })
    .lean();
  if (!pointer) return null;
  const run = await BackgroundAgentRun.findById(pointer.runId);
  return run ? buttonAgentRunOf(run) : null;
}
