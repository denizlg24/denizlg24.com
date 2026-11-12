import mongoose, { type Document, Schema } from "mongoose";

export interface IStudyDocumentExtraction extends Document {
  documentId: mongoose.Types.ObjectId;
  /** gzip of the JSON `PdfSource`, so a chunker bump re-chunks without the PDF. */
  data: Buffer;
  itemCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const StudyDocumentExtractionSchema = new Schema<IStudyDocumentExtraction>(
  {
    documentId: { type: Schema.Types.ObjectId, required: true },
    data: { type: Buffer, required: true },
    itemCount: { type: Number, required: true },
  },
  { collection: "study_document_extractions", timestamps: true },
);

StudyDocumentExtractionSchema.index({ documentId: 1 }, { unique: true });

export const StudyDocumentExtraction: mongoose.Model<IStudyDocumentExtraction> =
  (mongoose.models.StudyDocumentExtraction as
    | mongoose.Model<IStudyDocumentExtraction>
    | undefined) ||
  mongoose.model<IStudyDocumentExtraction>(
    "StudyDocumentExtraction",
    StudyDocumentExtractionSchema,
  );
