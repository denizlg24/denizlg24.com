import type {
  ILatexProject,
  LatexCompileStatus,
  LatexIngestionStatus,
  LatexProjectSettings,
} from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";

export interface IStoredLatexPdf {
  storageKey: string;
  filename: string;
  size: number;
  revision: number;
  updatedAt: Date;
}

export interface IStoredLatexIngestion {
  status: LatexIngestionStatus;
  updatedAt: Date | null;
  error: string | null;
}

export interface ILatexProjectDocument extends Document {
  name: string;
  project: ILatexProject;
  revision: number;
  compileCount: number;
  archivedAt: Date | null;
  compileStatus: LatexCompileStatus;
  compileError: string | null;
  compiledPdf: IStoredLatexPdf | null;
  settings: LatexProjectSettings;
  ingestion: IStoredLatexIngestion;
  conversationId: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanLatexProject
  extends Omit<ILatexProjectDocument, keyof Document | "conversationId"> {
  _id: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId | null;
}

const StoredLatexPdfSchema = new Schema<IStoredLatexPdf>(
  {
    storageKey: { type: String, required: true, maxlength: 1_000 },
    filename: { type: String, required: true, maxlength: 240 },
    size: { type: Number, required: true, min: 0 },
    revision: { type: Number, required: true, min: 0 },
    updatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const LatexProjectSchema = new Schema<ILatexProjectDocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    project: { type: Schema.Types.Mixed, required: true },
    revision: { type: Number, required: true, min: 0, default: 0 },
    compileCount: { type: Number, required: true, min: 0, default: 0 },
    archivedAt: { type: Date, default: null },
    compileStatus: {
      type: String,
      enum: ["never", "stale", "compiling", "ready", "error"],
      default: "never",
      required: true,
    },
    compileError: { type: String, maxlength: 20_000, default: null },
    compiledPdf: { type: StoredLatexPdfSchema, default: null },
    settings: {
      grammarDialect: {
        type: String,
        enum: ["american", "british"],
        default: "american",
      },
      bibliographyFile: { type: String, maxlength: 240, default: null },
      inlineCompletionEnabled: { type: Boolean, default: true },
      inlineCompletionModel: { type: String, maxlength: 200, default: null },
      agentProvider: {
        type: String,
        enum: ["hosted", "ollama"],
        default: "hosted",
      },
      agentModel: { type: String, maxlength: 200, default: null },
      embeddingProvider: {
        type: String,
        enum: ["hosted", "ollama"],
        default: "hosted",
      },
      embeddingModel: { type: String, maxlength: 200, default: null },
      agentMemoryMode: {
        type: String,
        enum: ["enabled", "retrieval-off"],
        default: "enabled",
      },
    },
    ingestion: {
      status: {
        type: String,
        enum: ["idle", "pending", "indexing", "ready", "error"],
        default: "idle",
      },
      updatedAt: { type: Date, default: null },
      error: { type: String, maxlength: 2_000, default: null },
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },
  },
  { collection: "latex_projects", timestamps: true },
);

LatexProjectSchema.index({ archivedAt: 1, updatedAt: -1 });
LatexProjectSchema.index({ compileStatus: 1, updatedAt: -1 });
LatexProjectSchema.index({ conversationId: 1 }, { sparse: true });

export const LatexProject: mongoose.Model<ILatexProjectDocument> =
  (mongoose.models.LatexProject as
    | mongoose.Model<ILatexProjectDocument>
    | undefined) ||
  mongoose.model<ILatexProjectDocument>("LatexProject", LatexProjectSchema);
