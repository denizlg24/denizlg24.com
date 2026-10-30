import type { BackgroundAgentPageContext, Block } from "@repo/schemas";
import { walkBlocks } from "@repo/utils/workspace-tree";
import { connectDB } from "@/lib/mongodb";
import { emitDomainEvent } from "@/lib/workflows/events";
import { mongoWorkspaceRepo } from "./mongo-repo";
import { createWorkspaceService } from "./service";

function hasSection(blocks: readonly Block[]): boolean {
  let found = false;
  walkBlocks(blocks, (block) => {
    if (block.type === "section") found = true;
  });
  return found;
}

/**
 * The process's one service: it caches that the migration already ran.
 * Every write that lands keeps agent sections' tasks in step with their
 * blocks, and a new page is a domain event.
 */
export const workspaceService = createWorkspaceService(mongoWorkspaceRepo, {
  onChange: (change) => {
    // Loaded on use: sections reach the agent task machinery, which reaches back here.
    if (
      hasSection(change.page.blocks) ||
      (change.previous && hasSection(change.previous.blocks))
    ) {
      void import("./sections").then((sections) =>
        sections.scheduleSectionReconcile(change),
      );
    }
    if (change.kind === "create" && !change.page.template) {
      void emitDomainEvent({
        type: "workspace.page.created",
        payload: {
          pageId: change.page.id,
          title: change.page.title,
          parentId: change.page.parentId ?? "",
          actor: change.caller.actor,
        },
      });
    }
  },
});

/**
 * The workspace page a turn was sent from, read fresh so the agent edits
 * against the rev the server holds. Null when the turn came from elsewhere or
 * the page cannot be read; a turn never fails over it.
 */
export async function openWorkspacePage(
  pageContext: BackgroundAgentPageContext | undefined,
) {
  const id = pageContext?.workspacePageId;
  if (!id) return null;
  try {
    await connectDB();
    await workspaceService.ensureMigrated();
    return await workspaceService.pageContext(id);
  } catch (error) {
    console.error("Failed to read the open workspace page:", error);
    return null;
  }
}
