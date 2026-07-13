import mongoose, { type Document, Schema } from "mongoose";
import {
  AGENT_EXPLICITNESS,
  AGENT_SENSITIVITIES,
  existingModel,
} from "./AgentMemoryCommon";

export const AGENT_USER_MODEL_SECTIONS = [
  "identity",
  "education-career-skills",
  "projects-responsibilities-ambitions",
  "people-organizations-relationships",
  "preferences-routines-constraints",
  "communication-work-style",
  "values-priorities-decisions",
  "goals-concerns-opportunities",
  "procedures",
  "hypotheses-reflections",
] as const;

export interface IAgentUserModelChunk {
  key: string;
  statement: string;
  evidenceIds: string[];
  memoryIds: mongoose.Types.ObjectId[];
  confidence: number;
  explicitness: "explicit" | "inferred" | "hypothesis";
  sensitivity: "standard" | "personal" | "sensitive" | "restricted";
  validFrom?: Date;
  validUntil?: Date;
  lastConfirmedAt?: Date;
}

export interface IAgentUserModel extends Document<string> {
  _id: "singleton";
  currentRevisionId: mongoose.Types.ObjectId;
  revision: number;
  sections: Record<string, IAgentUserModelChunk[]>;
  sourceMemoryRevision: number;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const AgentUserModelChunkSchema = new Schema<IAgentUserModelChunk>(
  {
    key: { type: String, required: true, maxlength: 256 },
    statement: { type: String, required: true, maxlength: 8_192 },
    evidenceIds: { type: [String], required: true },
    memoryIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "AgentMemory" }],
      default: [],
    },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    explicitness: {
      type: String,
      enum: AGENT_EXPLICITNESS,
      required: true,
    },
    sensitivity: {
      type: String,
      enum: AGENT_SENSITIVITIES.filter(
        (sensitivity) => sensitivity !== "denied",
      ),
      required: true,
    },
    validFrom: { type: Date },
    validUntil: { type: Date },
    lastConfirmedAt: { type: Date },
  },
  { _id: false },
);

const AgentUserModelSchema = new Schema<IAgentUserModel>(
  {
    _id: { type: String, default: "singleton" },
    currentRevisionId: {
      type: Schema.Types.ObjectId,
      ref: "AgentUserModelRevision",
      required: true,
    },
    revision: { type: Number, required: true, min: 1 },
    sections: { type: Schema.Types.Mixed, required: true, default: {} },
    sourceMemoryRevision: { type: Number, required: true, min: 0 },
    generatedAt: { type: Date, required: true },
  },
  { collection: "agent_user_models", timestamps: true, minimize: false },
);

export const AgentUserModel =
  existingModel<IAgentUserModel>("AgentUserModel") ||
  mongoose.model<IAgentUserModel>("AgentUserModel", AgentUserModelSchema);
