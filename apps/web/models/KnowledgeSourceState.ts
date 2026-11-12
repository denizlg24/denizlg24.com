import mongoose, { type Document, Schema } from "mongoose";

export const KNOWLEDGE_SOURCE_STATES = [
  "pending",
  "embedded",
  "failed",
  "empty",
] as const;
export type KnowledgeSourceStateValue =
  (typeof KNOWLEDGE_SOURCE_STATES)[number];

export interface IKnowledgeSourceState extends Document {
  sourceKey: string;
  state: KnowledgeSourceStateValue;
  chunkCount: number;
  chunkerVersion?: number;
  error?: string;
  indexedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanKnowledgeSourceState {
  _id: mongoose.Types.ObjectId;
  sourceKey: string;
  state: KnowledgeSourceStateValue;
  chunkCount: number;
  chunkerVersion?: number;
  error?: string;
  indexedAt?: Date;
}

const KnowledgeSourceStateSchema = new Schema<IKnowledgeSourceState>(
  {
    sourceKey: { type: String, required: true },
    state: { type: String, enum: KNOWLEDGE_SOURCE_STATES, required: true },
    chunkCount: { type: Number, default: 0 },
    chunkerVersion: { type: Number },
    error: { type: String, maxlength: 2_000 },
    indexedAt: { type: Date },
  },
  { collection: "knowledge_source_states", timestamps: true },
);

KnowledgeSourceStateSchema.index({ sourceKey: 1 }, { unique: true });
KnowledgeSourceStateSchema.index({ state: 1 });

export const KnowledgeSourceState: mongoose.Model<IKnowledgeSourceState> =
  (mongoose.models.KnowledgeSourceState as
    | mongoose.Model<IKnowledgeSourceState>
    | undefined) ||
  mongoose.model<IKnowledgeSourceState>(
    "KnowledgeSourceState",
    KnowledgeSourceStateSchema,
  );
