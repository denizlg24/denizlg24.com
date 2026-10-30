import type { BackgroundAgentPageContext } from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import { mongoWorkspaceRepo } from "./mongo-repo";
import { scheduleSectionReconcile } from "./sections";
import { createWorkspaceService } from "./service";

/**
 * The process's one service: it caches that the migration already ran.
 * Every write that lands keeps agent sections' tasks in step with their blocks.
 */
export const workspaceService = createWorkspaceService(mongoWorkspaceRepo, {
  onChange: (change) => scheduleSectionReconcile(change),
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
