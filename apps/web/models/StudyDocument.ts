import mongoose, { type Document, Schema } from "mongoose";

export interface IStudyDocumentFields {
  title: string;
  fileName: string;
  fileUrl: string;
  storageKey: string;
  size: number;
  pageCount?: number;
  layout?: "document" | "slides";
  extraction: "pending" | "ready" | "empty" | "failed";
  extractionError?: string;
  courseId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IStudyDocument extends IStudyDocumentFields, Document {}

export type ILeanStudyDocument = IStudyDocumentFields & {
  _id: mongoose.Types.ObjectId;
};

const StudyDocumentSchema = new Schema<IStudyDocument>(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    storageKey: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    pageCount: { type: Number },
    layout: { type: String, enum: ["document", "slides"] },
    extraction: {
      type: String,
      enum: ["pending", "ready", "empty", "failed"],
      default: "pending",
    },
    extractionError: { type: String, maxlength: 2_000 },
    courseId: { type: Schema.Types.ObjectId, ref: "Course" },
  },
  { collection: "study_documents", timestamps: true },
);

StudyDocumentSchema.index({ createdAt: -1 });
StudyDocumentSchema.index({ courseId: 1 });

export const StudyDocument: mongoose.Model<IStudyDocument> =
  (mongoose.models.StudyDocument as
    | mongoose.Model<IStudyDocument>
    | undefined) ||
  mongoose.model<IStudyDocument>("StudyDocument", StudyDocumentSchema);
