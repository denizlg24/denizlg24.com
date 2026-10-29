import type { Workspace } from "@repo/schemas";
import mongoose from "mongoose";

/**
 * The workspace desktop and web share, as one document. It is validated by
 * `workspaceSchema` on the way in and replaced whole on every save, so Mongo
 * holds it as an opaque value rather than a mirrored schema.
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
