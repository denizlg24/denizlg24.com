import mongoose from "mongoose";

/**
 * Which background run a button's agent prompt started. Kept beside the page
 * rather than on the block, so pressing a button never bumps the page's rev.
 */
export interface IWorkspaceButtonRun {
  pageId: string;
  blockId: string;
  runId: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId;
  createdAt: Date;
}

const workspaceButtonRunSchema = new mongoose.Schema<IWorkspaceButtonRun>(
  {
    pageId: { type: String, required: true },
    blockId: { type: String, required: true },
    runId: { type: mongoose.Schema.Types.ObjectId, required: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, required: true },
  },
  { collection: "workspace_button_runs", versionKey: false },
);

workspaceButtonRunSchema.index({ pageId: 1, blockId: 1, createdAt: -1 });
// The run itself outlives this pointer; a quarter of history is plenty for a block.
workspaceButtonRunSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

export const WorkspaceButtonRunModel: mongoose.Model<IWorkspaceButtonRun> =
  mongoose.models.WorkspaceButtonRun ||
  mongoose.model<IWorkspaceButtonRun>(
    "WorkspaceButtonRun",
    workspaceButtonRunSchema,
  );
