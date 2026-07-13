import type {
  AgentEntityRef,
  AgentExplicitness,
  AgentMemoryStatus,
  AgentMemoryType,
  AgentSensitivity,
  AgentTemporal,
  AgentTrust,
} from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";
import {
  AGENT_EXPLICITNESS,
  AGENT_MEMORY_STATUSES,
  AGENT_MEMORY_TYPES,
  AGENT_SENSITIVITIES,
  AGENT_TRUST_LEVELS,
  AgentEntityRefSchema,
  AgentTemporalSchema,
  existingModel,
} from "./AgentMemoryCommon";

export interface IAgentMemoryRevision extends Document {
  memoryId: mongoose.Types.ObjectId;
  revision: number;
  statement: string;
  memoryType: AgentMemoryType;
  status: AgentMemoryStatus;
  explicitness: AgentExplicitness;
  confidence: number;
  importance: number;
  trust: AgentTrust;
  sensitivity: AgentSensitivity;
  temporal: AgentTemporal;
  entityRefs: AgentEntityRef[];
  evidenceIds: string[];
  contradictionIds: mongoose.Types.ObjectId[];
  supersedesMemoryId?: mongoose.Types.ObjectId;
  createdBy: "user" | "agent" | "policy" | "rollback";
  decisionReason: string;
  createdAt: Date;
}

const AgentMemoryRevisionSchema = new Schema<IAgentMemoryRevision>(
  {
    memoryId: {
      type: Schema.Types.ObjectId,
      ref: "AgentMemory",
      required: true,
      immutable: true,
    },
    revision: { type: Number, required: true, min: 1, immutable: true },
    statement: {
      type: String,
      required: true,
      maxlength: 8_192,
      immutable: true,
    },
    memoryType: {
      type: String,
      enum: AGENT_MEMORY_TYPES,
      required: true,
      immutable: true,
    },
    status: {
      type: String,
      enum: AGENT_MEMORY_STATUSES,
      required: true,
      immutable: true,
    },
    explicitness: {
      type: String,
      enum: AGENT_EXPLICITNESS,
      required: true,
      immutable: true,
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      immutable: true,
    },
    importance: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      immutable: true,
    },
    trust: {
      type: String,
      enum: AGENT_TRUST_LEVELS,
      required: true,
      immutable: true,
    },
    sensitivity: {
      type: String,
      enum: AGENT_SENSITIVITIES,
      required: true,
      immutable: true,
    },
    temporal: { type: AgentTemporalSchema, required: true, immutable: true },
    entityRefs: { type: [AgentEntityRefSchema], default: [], immutable: true },
    evidenceIds: { type: [String], required: true, immutable: true },
    contradictionIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "AgentMemory" }],
      default: [],
      immutable: true,
    },
    supersedesMemoryId: {
      type: Schema.Types.ObjectId,
      ref: "AgentMemory",
      immutable: true,
    },
    createdBy: {
      type: String,
      enum: ["user", "agent", "policy", "rollback"],
      required: true,
      immutable: true,
    },
    decisionReason: {
      type: String,
      required: true,
      maxlength: 4_096,
      immutable: true,
    },
  },
  {
    collection: "agent_memory_revisions",
    timestamps: { createdAt: true, updatedAt: false },
  },
);

AgentMemoryRevisionSchema.index({ memoryId: 1, revision: 1 }, { unique: true });
AgentMemoryRevisionSchema.index({ evidenceIds: 1, createdAt: -1 });

export const AgentMemoryRevision =
  existingModel<IAgentMemoryRevision>("AgentMemoryRevision") ||
  mongoose.model<IAgentMemoryRevision>(
    "AgentMemoryRevision",
    AgentMemoryRevisionSchema,
  );
