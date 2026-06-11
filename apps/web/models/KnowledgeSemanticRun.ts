import mongoose, { Schema } from "mongoose";

export type KnowledgeSemanticRunStatus = "running" | "completed" | "failed";

export interface SemanticRunParameters {
  topK: number;
  minSimilarity: number;
  strongSimilarity: number;
  clusterMinSize: number;
  maxGroupsPerNote: number;
}

export interface IKnowledgeSemanticRun {
  status: KnowledgeSemanticRunStatus;
  model: string;
  initiatedBy: "desktop" | "script";
  noteCount: number;
  embeddedCount: number;
  staleCount: number;
  edgeCount: number;
  clusterCount: number;
  parameters: SemanticRunParameters;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanKnowledgeSemanticRun {
  _id: string;
  status: KnowledgeSemanticRunStatus;
  model: string;
  initiatedBy: "desktop" | "script";
  noteCount: number;
  embeddedCount: number;
  staleCount: number;
  edgeCount: number;
  clusterCount: number;
  parameters: SemanticRunParameters;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MODEL_NAME = "KnowledgeSemanticRun";
const COLLECTION_NAME = "knowledge_semantic_runs";

const DEFAULT_PARAMETERS = {
  topK: 8,
  minSimilarity: 0.72,
  strongSimilarity: 0.82,
  clusterMinSize: 3,
  maxGroupsPerNote: 3,
} as const satisfies SemanticRunParameters;

const KnowledgeSemanticRunSchema = new Schema<IKnowledgeSemanticRun>(
  {
    status: {
      type: String,
      enum: ["running", "completed", "failed"],
      default: "running",
      index: true,
    },
    model: { type: String, required: true, index: true },
    initiatedBy: {
      type: String,
      enum: ["desktop", "script"],
      default: "desktop",
    },
    noteCount: { type: Number, default: 0 },
    embeddedCount: { type: Number, default: 0 },
    staleCount: { type: Number, default: 0 },
    edgeCount: { type: Number, default: 0 },
    clusterCount: { type: Number, default: 0 },
    parameters: {
      topK: { type: Number, default: DEFAULT_PARAMETERS.topK },
      minSimilarity: {
        type: Number,
        default: DEFAULT_PARAMETERS.minSimilarity,
      },
      strongSimilarity: {
        type: Number,
        default: DEFAULT_PARAMETERS.strongSimilarity,
      },
      clusterMinSize: {
        type: Number,
        default: DEFAULT_PARAMETERS.clusterMinSize,
      },
      maxGroupsPerNote: {
        type: Number,
        default: DEFAULT_PARAMETERS.maxGroupsPerNote,
      },
    },
    startedAt: { type: Date, default: Date.now, index: true },
    completedAt: { type: Date },
    error: { type: String },
  },
  { timestamps: true },
);

KnowledgeSemanticRunSchema.index({ startedAt: -1 });

export const KnowledgeSemanticRun: mongoose.Model<IKnowledgeSemanticRun> =
  (mongoose.models[MODEL_NAME] as
    | mongoose.Model<IKnowledgeSemanticRun>
    | undefined) ||
  mongoose.model<IKnowledgeSemanticRun>(
    MODEL_NAME,
    KnowledgeSemanticRunSchema,
    COLLECTION_NAME,
  );

export { DEFAULT_PARAMETERS as SEMANTIC_DEFAULT_PARAMETERS };
