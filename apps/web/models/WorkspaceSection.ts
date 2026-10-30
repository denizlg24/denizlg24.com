import type { Block, SectionOutcome } from "@repo/schemas";
import mongoose from "mongoose";

/**
 * What an agent section's runs left behind, beside the page so a run never
 * has to rewrite the block's config. `baseline` is the children as the last
 * write (a run's or an accepted proposal) left them: children that differ
 * from it were edited since, and the next run proposes instead of writing.
 */
export interface IWorkspaceSection {
  _id: string;
  pageId: string;
  blockId: string;
  baseline: Block[] | null;
  lastRun: {
    runId: string;
    status: "queued" | "running" | "completed" | "failed";
    at: Date;
    outcome?: SectionOutcome;
    error?: string;
  } | null;
  proposal: { runId: string; at: Date; blocks: Block[] } | null;
  updatedAt: Date;
}

const workspaceSectionSchema = new mongoose.Schema<IWorkspaceSection>(
  {
    _id: { type: String, required: true },
    pageId: { type: String, required: true },
    blockId: { type: String, required: true },
    baseline: { type: mongoose.Schema.Types.Mixed, default: null },
    lastRun: { type: mongoose.Schema.Types.Mixed, default: null },
    proposal: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedAt: { type: Date, required: true },
  },
  { collection: "workspace_sections", minimize: false, versionKey: false },
);

workspaceSectionSchema.index({ pageId: 1 });

export function sectionKey(pageId: string, blockId: string): string {
  return `${pageId}:${blockId}`;
}

export const WorkspaceSectionModel: mongoose.Model<IWorkspaceSection> =
  mongoose.models.WorkspaceSection ||
  mongoose.model<IWorkspaceSection>("WorkspaceSection", workspaceSectionSchema);
