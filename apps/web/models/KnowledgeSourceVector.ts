import mongoose, { Schema } from "mongoose";

export interface IKnowledgeSourceVector {
  sourceKey: string;
  kind: "note" | "document" | "voice-note";
  id: mongoose.Types.ObjectId;
  model: string;
  /** Normalized mean of the source's chunk vectors. */
  vector: number[];
  chunkCount: number;
  updatedAt: Date;
}

export type ILeanKnowledgeSourceVector = IKnowledgeSourceVector & {
  _id: mongoose.Types.ObjectId;
};

const KnowledgeSourceVectorSchema = new Schema<IKnowledgeSourceVector>(
  {
    sourceKey: { type: String, required: true },
    kind: {
      type: String,
      enum: ["note", "document", "voice-note"],
      required: true,
    },
    id: { type: Schema.Types.ObjectId, required: true },
    model: { type: String, required: true },
    vector: { type: [Number], required: true, select: false },
    chunkCount: { type: Number, required: true, min: 0 },
  },
  {
    collection: "knowledge_source_vectors",
    timestamps: { createdAt: false, updatedAt: true },
  },
);

KnowledgeSourceVectorSchema.index({ sourceKey: 1, model: 1 }, { unique: true });
KnowledgeSourceVectorSchema.index({ kind: 1, model: 1 });

export const KnowledgeSourceVector: mongoose.Model<IKnowledgeSourceVector> =
  (mongoose.models.KnowledgeSourceVector as
    | mongoose.Model<IKnowledgeSourceVector>
    | undefined) ||
  mongoose.model<IKnowledgeSourceVector>(
    "KnowledgeSourceVector",
    KnowledgeSourceVectorSchema,
  );
