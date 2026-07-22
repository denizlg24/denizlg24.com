import mongoose, { type Document, Schema } from "mongoose";

export interface ILatexProjectReference extends Document {
  projectId: mongoose.Types.ObjectId;
  paperId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const LatexProjectReferenceSchema = new Schema<ILatexProjectReference>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "LatexProject",
      required: true,
      index: true,
    },
    paperId: {
      type: Schema.Types.ObjectId,
      ref: "Paper",
      required: true,
      index: true,
    },
  },
  { collection: "latex_project_references", timestamps: true },
);

LatexProjectReferenceSchema.index(
  { projectId: 1, paperId: 1 },
  { unique: true },
);

export const LatexProjectReference: mongoose.Model<ILatexProjectReference> =
  (mongoose.models.LatexProjectReference as
    | mongoose.Model<ILatexProjectReference>
    | undefined) ||
  mongoose.model<ILatexProjectReference>(
    "LatexProjectReference",
    LatexProjectReferenceSchema,
  );
