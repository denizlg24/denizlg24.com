import type { Block, WorkspacePage } from "@repo/schemas";
import mongoose from "mongoose";

/**
 * One workspace page. `rev` counts every change; writes compare-and-set on it.
 * A purged page stays as a tombstone (no blocks, `purgedAt` set) so the change
 * feed can report it.
 */
export interface IWorkspacePage {
  _id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  order: number;
  blocks: Block[];
  fullWidth: boolean;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  rev: number;
  changedAt: Date;
  purgedAt: Date | null;
  /** What desktop 3.0.0 last held of this page; its whole-document PUT is merged against it. */
  compatBase: WorkspacePage | null;
}

const workspacePageSchema = new mongoose.Schema<IWorkspacePage>(
  {
    _id: { type: String, required: true },
    title: { type: String, default: "" },
    icon: { type: String, default: null },
    parentId: { type: String, default: null },
    order: { type: Number, default: 0 },
    blocks: { type: mongoose.Schema.Types.Mixed, default: [] },
    fullWidth: { type: Boolean, default: false },
    locked: { type: Boolean, default: false },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
    deletedAt: { type: String, default: null },
    rev: { type: Number, required: true },
    changedAt: { type: Date, required: true },
    purgedAt: { type: Date, default: null },
    compatBase: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { minimize: false, versionKey: false },
);

workspacePageSchema.index({ changedAt: 1 });

export const WorkspacePageModel: mongoose.Model<IWorkspacePage> =
  mongoose.models.WorkspacePage ||
  mongoose.model<IWorkspacePage>("WorkspacePage", workspacePageSchema);
