import type { KnowledgeSourceKind } from "@repo/schemas";
import mongoose, { Schema } from "mongoose";

export interface INotebookSource {
  kind: KnowledgeSourceKind;
  id: mongoose.Types.ObjectId;
  addedAt: Date;
}

export interface INotebook {
  title: string;
  icon?: string;
  courseId?: mongoose.Types.ObjectId;
  sources: INotebookSource[];
  excluded: string[];
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanNotebook extends INotebook {
  _id: mongoose.Types.ObjectId;
}

const SourceSchema = new Schema<INotebookSource>(
  {
    kind: {
      type: String,
      enum: ["note", "document", "voice-note"],
      required: true,
    },
    id: { type: Schema.Types.ObjectId, required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const NotebookSchema = new Schema<INotebook>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    icon: { type: String, maxlength: 64 },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", index: true },
    sources: { type: [SourceSchema], default: [] },
    excluded: { type: [String], default: [] },
    archivedAt: { type: Date },
  },
  { timestamps: true },
);

NotebookSchema.index({ archivedAt: 1, updatedAt: -1 });

export const Notebook: mongoose.Model<INotebook> =
  (mongoose.models.StudyNotebook as mongoose.Model<INotebook> | undefined) ||
  mongoose.model<INotebook>("StudyNotebook", NotebookSchema, "study_notebooks");
