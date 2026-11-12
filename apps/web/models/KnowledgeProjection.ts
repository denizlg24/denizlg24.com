import mongoose, { Schema } from "mongoose";

export interface IKnowledgeProjectionNode {
  key: string;
  x: number;
  y: number;
}

export interface IKnowledgeProjectionNeighbor {
  key: string;
  similarity: number;
}

export interface IKnowledgeProjection {
  /** `all` or `notebook:<id>`. */
  scope: string;
  model: string;
  inputHash: string;
  nodes: IKnowledgeProjectionNode[];
  neighbors: Record<string, IKnowledgeProjectionNeighbor[]>;
  computedAt: Date;
  status: "ready" | "failed";
  error?: string;
}

export type ILeanKnowledgeProjection = IKnowledgeProjection & {
  _id: mongoose.Types.ObjectId;
};

const KnowledgeProjectionSchema = new Schema<IKnowledgeProjection>(
  {
    scope: { type: String, required: true },
    model: { type: String, required: true },
    inputHash: { type: String, required: true },
    nodes: {
      type: [new Schema({ key: String, x: Number, y: Number }, { _id: false })],
      default: [],
    },
    neighbors: { type: Schema.Types.Mixed, default: {} },
    computedAt: { type: Date, required: true },
    status: { type: String, enum: ["ready", "failed"], default: "ready" },
    error: { type: String, maxlength: 2_000 },
  },
  { collection: "knowledge_projections", minimize: false },
);

KnowledgeProjectionSchema.index(
  { scope: 1, model: 1, inputHash: 1 },
  { unique: true },
);
KnowledgeProjectionSchema.index({ scope: 1, model: 1, computedAt: -1 });

export const KnowledgeProjection: mongoose.Model<IKnowledgeProjection> =
  (mongoose.models.KnowledgeProjection as
    | mongoose.Model<IKnowledgeProjection>
    | undefined) ||
  mongoose.model<IKnowledgeProjection>(
    "KnowledgeProjection",
    KnowledgeProjectionSchema,
  );
