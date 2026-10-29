import type {
  WorkspaceAppliedOp,
  WorkspacePage,
  WorkspaceRevisionKind,
} from "@repo/schemas";
import mongoose from "mongoose";

/**
 * One change to one page. `ops` replay it, `inverse` undoes it, `touched` is
 * what rebasing checks, and `snapshot` (the page after this revision) is kept
 * periodically so a past rev can be rebuilt without replaying from rev 1.
 */
export interface IWorkspacePageRevision {
  pageId: string;
  rev: number;
  actor: string;
  via: string | null;
  kind: WorkspaceRevisionKind;
  at: Date;
  ops: WorkspaceAppliedOp[];
  inverse: WorkspaceAppliedOp[];
  touched: string[];
  snapshot: WorkspacePage | null;
}

const workspacePageRevisionSchema = new mongoose.Schema<IWorkspacePageRevision>(
  {
    pageId: { type: String, required: true },
    rev: { type: Number, required: true },
    actor: { type: String, required: true },
    via: { type: String, default: null },
    kind: { type: String, required: true },
    at: { type: Date, required: true },
    ops: { type: [mongoose.Schema.Types.Mixed], default: [] },
    inverse: { type: [mongoose.Schema.Types.Mixed], default: [] },
    touched: { type: [String], default: [] },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { minimize: false, versionKey: false },
);

workspacePageRevisionSchema.index({ pageId: 1, rev: 1 }, { unique: true });

export const WorkspacePageRevisionModel: mongoose.Model<IWorkspacePageRevision> =
  mongoose.models.WorkspacePageRevision ||
  mongoose.model<IWorkspacePageRevision>(
    "WorkspacePageRevision",
    workspacePageRevisionSchema,
  );
