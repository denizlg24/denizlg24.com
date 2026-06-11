import mongoose, { Schema } from "mongoose";

export interface INoteEmbedding {
  noteId: mongoose.Types.ObjectId;
  model: string;
  dimension: number;
  vector: number[];
  contentHash: string;
  inputTextPreview: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanNoteEmbedding {
  _id: string;
  noteId: string;
  model: string;
  dimension: number;
  vector: number[];
  contentHash: string;
  inputTextPreview: string;
  createdAt: Date;
  updatedAt: Date;
}

const NOTE_EMBEDDING_MODEL_NAME = "KnowledgeNoteEmbedding";
const NOTE_EMBEDDING_COLLECTION_NAME = "knowledge_note_embeddings";

const NoteEmbeddingSchema = new Schema<INoteEmbedding>(
  {
    noteId: {
      type: Schema.Types.ObjectId,
      ref: "KnowledgeNote",
      required: true,
      index: true,
    },
    model: { type: String, required: true, index: true },
    dimension: { type: Number, required: true },
    vector: [{ type: Number, required: true }],
    contentHash: { type: String, required: true, index: true },
    inputTextPreview: { type: String, default: "" },
  },
  { timestamps: true },
);

NoteEmbeddingSchema.index({ noteId: 1, model: 1 }, { unique: true });
NoteEmbeddingSchema.index({ updatedAt: -1 });

export const NoteEmbedding: mongoose.Model<INoteEmbedding> =
  (mongoose.models[NOTE_EMBEDDING_MODEL_NAME] as
    | mongoose.Model<INoteEmbedding>
    | undefined) ||
  mongoose.model<INoteEmbedding>(
    NOTE_EMBEDDING_MODEL_NAME,
    NoteEmbeddingSchema,
    NOTE_EMBEDDING_COLLECTION_NAME,
  );
