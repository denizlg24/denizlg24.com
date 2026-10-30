import type {
  SidebarPrefs,
  WorkspacePrefsInput,
  WorkspaceRef,
} from "@repo/schemas";
import mongoose from "mongoose";

/**
 * Favorites, recents and sidebar layout: the singleton beside the pages. Its
 * existence also marks the v1 `DesktopWorkspace` document as migrated.
 */
export interface IWorkspacePrefs {
  _id: string;
  favorites: WorkspaceRef[];
  recents: WorkspaceRef[];
  sidebar: SidebarPrefs;
  updatedAt: string;
  changedAt: Date;
  /** What desktop 3.0.0 last held; its whole-document PUT is merged against it. */
  compatBase: WorkspacePrefsInput | null;
  migratedAt: Date;
  /** `savedAt` of the v1 document the pages came from; null when there was none. */
  migratedFrom: string | null;
}

const workspacePrefsSchema = new mongoose.Schema<IWorkspacePrefs>(
  {
    _id: { type: String, required: true },
    favorites: { type: [String], default: [] },
    recents: { type: [String], default: [] },
    sidebar: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: String, required: true },
    changedAt: { type: Date, required: true },
    compatBase: { type: mongoose.Schema.Types.Mixed, default: null },
    migratedAt: { type: Date, required: true },
    migratedFrom: { type: String, default: null },
  },
  { minimize: false, versionKey: false },
);

export const WorkspacePrefsModel: mongoose.Model<IWorkspacePrefs> =
  mongoose.models.WorkspacePrefs ||
  mongoose.model<IWorkspacePrefs>("WorkspacePrefs", workspacePrefsSchema);
