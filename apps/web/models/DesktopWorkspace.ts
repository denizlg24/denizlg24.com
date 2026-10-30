import type { Workspace } from "@repo/schemas";
import mongoose from "mongoose";

/**
 * The v1 workspace, one whole document. Superseded by `WorkspacePage` and
 * `WorkspacePrefs`, which `lib/workspace` migrates it into on first use; it
 * is kept as the backup and never written again.
 */
export interface IDesktopWorkspace {
  _id: string;
  data: Workspace;
  updatedAt: Date;
}

const desktopWorkspaceSchema = new mongoose.Schema<IDesktopWorkspace>(
  {
    _id: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: false, updatedAt: true }, minimize: false },
);

export const DesktopWorkspace: mongoose.Model<IDesktopWorkspace> =
  mongoose.models.DesktopWorkspace ||
  mongoose.model<IDesktopWorkspace>("DesktopWorkspace", desktopWorkspaceSchema);
