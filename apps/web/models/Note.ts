import mongoose, { type Document, Schema } from "mongoose";

export type NoteStatus = "open" | "archived";
export type NoteSemanticStatus = "pending" | "embedded" | "stale" | "failed";

export interface INote extends Document {
  title: string;
  content: string;
  url?: string;
  description?: string;
  siteName?: string;
  favicon?: string;
  image?: string;
  publishedDate?: Date;
  tags: string[];
  groupIds: mongoose.Types.ObjectId[];
  manualGroupIds?: mongoose.Types.ObjectId[];
  status: NoteStatus;
  class?: string;
  semanticKeywords?: string[];
  semanticSummary?: string;
  semanticModel?: string;
  semanticStatus?: NoteSemanticStatus;
  semanticContentHash?: string;
  semanticUpdatedAt?: Date;
  semanticError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanNote {
  _id: string;
  title: string;
  content: string;
  url?: string;
  description?: string;
  siteName?: string;
  favicon?: string;
  image?: string;
  publishedDate?: Date;
  tags: string[];
  groupIds: string[];
  manualGroupIds?: string[];
  status: NoteStatus;
  class?: string;
  semanticKeywords?: string[];
  semanticSummary?: string;
  semanticModel?: string;
  semanticStatus?: NoteSemanticStatus;
  semanticContentHash?: string;
  semanticUpdatedAt?: Date;
  semanticError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const NOTE_MODEL_NAME = "KnowledgeNote";
const NOTE_COLLECTION_NAME = "knowledge_notes";

const NoteSchema = new Schema<INote>(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, default: "" },
    url: { type: String, trim: true, index: true, sparse: true },
    description: { type: String },
    siteName: { type: String },
    favicon: { type: String },
    image: { type: String },
    publishedDate: { type: Date },
    tags: [{ type: String, trim: true }],
    groupIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "KnowledgeNoteGroup",
        index: true,
      },
    ],
    manualGroupIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "KnowledgeNoteGroup",
        index: true,
      },
    ],
    status: {
      type: String,
      enum: ["open", "archived"],
      default: "open",
      index: true,
    },
    class: { type: String, trim: true },
    semanticKeywords: [{ type: String, trim: true }],
    semanticSummary: { type: String },
    semanticModel: { type: String },
    semanticStatus: {
      type: String,
      enum: ["pending", "embedded", "stale", "failed"],
      default: "pending",
      index: true,
    },
    semanticContentHash: { type: String, index: true },
    semanticUpdatedAt: { type: Date },
    semanticError: { type: String },
  },
  { timestamps: true },
);

NoteSchema.index({ createdAt: -1 });
NoteSchema.index({ updatedAt: -1 });
NoteSchema.index({ tags: 1 });
NoteSchema.index({ title: "text", content: "text" });

export const Note: mongoose.Model<INote> =
  (mongoose.models[NOTE_MODEL_NAME] as mongoose.Model<INote> | undefined) ||
  mongoose.model<INote>(NOTE_MODEL_NAME, NoteSchema, NOTE_COLLECTION_NAME);
