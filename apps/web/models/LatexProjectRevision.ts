import type {
  ILatexProject,
  LatexProjectChangedFile,
  LatexProjectHistoryAction,
} from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";

export interface ILatexProjectRevisionDocument extends Document {
  projectId: mongoose.Types.ObjectId;
  revision: number;
  name: string;
  action: LatexProjectHistoryAction;
  compileCount: number;
  changedFiles: LatexProjectChangedFile[];
  project: ILatexProject;
  createdAt: Date;
  updatedAt: Date;
}

const ChangedFileSchema = new Schema<LatexProjectChangedFile>(
  {
    path: { type: String, required: true, maxlength: 240 },
    status: {
      type: String,
      enum: ["added", "modified", "deleted"],
      required: true,
    },
  },
  { _id: false },
);

const LatexProjectRevisionSchema = new Schema<ILatexProjectRevisionDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "LatexProject",
      required: true,
      index: true,
    },
    revision: { type: Number, required: true, min: 0 },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    action: {
      type: String,
      enum: ["create", "edit", "rename", "restore"],
      required: true,
    },
    compileCount: { type: Number, required: true, min: 0 },
    changedFiles: { type: [ChangedFileSchema], default: [] },
    project: { type: Schema.Types.Mixed, required: true },
  },
  { collection: "latex_project_revisions", timestamps: true },
);

LatexProjectRevisionSchema.index({ projectId: 1, updatedAt: -1 });
LatexProjectRevisionSchema.index({ projectId: 1, revision: -1 });
LatexProjectRevisionSchema.index(
  { projectId: 1 },
  { unique: true, partialFilterExpression: { action: "create" } },
);

export const LatexProjectRevision: mongoose.Model<ILatexProjectRevisionDocument> =
  (mongoose.models.LatexProjectRevision as
    | mongoose.Model<ILatexProjectRevisionDocument>
    | undefined) ||
  mongoose.model<ILatexProjectRevisionDocument>(
    "LatexProjectRevision",
    LatexProjectRevisionSchema,
  );
