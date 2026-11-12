import mongoose, { Schema } from "mongoose";

export const KNOWLEDGE_CHUNK_STATUSES = ["active"] as const;
export type KnowledgeChunkStatus = (typeof KNOWLEDGE_CHUNK_STATUSES)[number];

export interface IKnowledgeChunk {
  sourceKind: "note" | "document" | "voice-note";
  sourceId: mongoose.Types.ObjectId;
  sourceKey: string;
  ordinal: number;
  title: string;
  headingPath: string[];
  page?: { start: number; end: number };
  startMs?: number;
  endMs?: number;
  /** What the UI quotes; the only field `$text` runs on. */
  body: string;
  /** Header + body: exactly what was embedded. */
  text: string;
  sourceStart?: number;
  sourceEnd?: number;
  tokenCount: number;
  contentHash: string;
  /** Hash of `body` alone: survives a rename, which changes `contentHash`. Absent on older rows. */
  bodyHash?: string;
  chunkerVersion: number;
  model: string;
  vector: number[];
  embeddedAt: Date;
  status: KnowledgeChunkStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type ILeanKnowledgeChunk = IKnowledgeChunk & {
  _id: mongoose.Types.ObjectId;
};

const KnowledgeChunkSchema = new Schema<IKnowledgeChunk>(
  {
    sourceKind: {
      type: String,
      enum: ["note", "document", "voice-note"],
      required: true,
    },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    sourceKey: { type: String, required: true },
    ordinal: { type: Number, required: true, min: 0 },
    title: { type: String, default: "" },
    headingPath: { type: [String], default: [] },
    page: {
      type: new Schema({ start: Number, end: Number }, { _id: false }),
    },
    startMs: { type: Number },
    endMs: { type: Number },
    body: { type: String, required: true },
    text: { type: String, required: true },
    sourceStart: { type: Number },
    sourceEnd: { type: Number },
    tokenCount: { type: Number, required: true, min: 0 },
    contentHash: { type: String, required: true },
    bodyHash: { type: String },
    chunkerVersion: { type: Number, required: true },
    model: { type: String, required: true },
    vector: { type: [Number], required: true, select: false },
    embeddedAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active"],
      default: "active",
    },
  },
  { collection: "knowledge_chunks", timestamps: true },
);

KnowledgeChunkSchema.index({ sourceKey: 1, ordinal: 1 }, { unique: true });
KnowledgeChunkSchema.index({ contentHash: 1, model: 1 });
// One text index per collection; stemming off because notes mix languages and
// a wrong stemmer costs exact-term matches, which is what this half is for.
KnowledgeChunkSchema.index({ body: "text" }, { default_language: "none" });

export const KnowledgeChunk: mongoose.Model<IKnowledgeChunk> =
  (mongoose.models.KnowledgeChunk as
    | mongoose.Model<IKnowledgeChunk>
    | undefined) ||
  mongoose.model<IKnowledgeChunk>("KnowledgeChunk", KnowledgeChunkSchema);
