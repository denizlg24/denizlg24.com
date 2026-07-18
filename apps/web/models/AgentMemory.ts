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

export interface IAgentMemory extends Document {
  currentRevisionId: mongoose.Types.ObjectId;
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
  pinned: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const AgentMemoryProjectionFields = {
  currentRevisionId: {
    type: Schema.Types.ObjectId,
    ref: "AgentMemoryRevision",
    required: true,
  },
  revision: { type: Number, required: true, min: 1 },
  statement: { type: String, required: true, maxlength: 8_192 },
  memoryType: { type: String, enum: AGENT_MEMORY_TYPES, required: true },
  status: { type: String, enum: AGENT_MEMORY_STATUSES, required: true },
  explicitness: { type: String, enum: AGENT_EXPLICITNESS, required: true },
  confidence: { type: Number, required: true, min: 0, max: 1 },
  importance: { type: Number, required: true, min: 0, max: 1 },
  trust: { type: String, enum: AGENT_TRUST_LEVELS, required: true },
  sensitivity: { type: String, enum: AGENT_SENSITIVITIES, required: true },
  temporal: { type: AgentTemporalSchema, required: true },
  entityRefs: { type: [AgentEntityRefSchema], default: [] },
  evidenceIds: {
    type: [String],
    required: true,
    validate: (v: string[]) => v.length > 0,
  },
  contradictionIds: {
    type: [{ type: Schema.Types.ObjectId, ref: "AgentMemory" }],
    default: [],
  },
  supersedesMemoryId: { type: Schema.Types.ObjectId, ref: "AgentMemory" },
  pinned: { type: Boolean, default: false },
  deletedAt: { type: Date },
};

const AgentMemorySchema = new Schema<IAgentMemory>(
  AgentMemoryProjectionFields,
  {
    collection: "agent_memories",
    timestamps: true,
  },
);

AgentMemorySchema.index({ status: 1, memoryType: 1, importance: -1 });
// List view cursor pagination: one index per sort so page fetches walk the
// index instead of sorting the collection in memory.
AgentMemorySchema.index({ status: 1, importance: -1, updatedAt: -1, _id: 1 });
AgentMemorySchema.index({ status: 1, confidence: -1, updatedAt: -1, _id: 1 });
AgentMemorySchema.index({ status: 1, updatedAt: -1, _id: 1 });
// Graph load: active memories sorted by creation (stable node order keeps the
// client's no-change comparison from reheating the force layout).
AgentMemorySchema.index({ status: 1, createdAt: 1 });
AgentMemorySchema.index({
  status: 1,
  "temporal.validFrom": -1,
  "temporal.validUntil": 1,
});
AgentMemorySchema.index({
  "entityRefs.entityType": 1,
  "entityRefs.entityId": 1,
  status: 1,
});
AgentMemorySchema.index({ evidenceIds: 1, status: 1 });
AgentMemorySchema.index({ statement: "text" });

export const AgentMemory =
  existingModel<IAgentMemory>("AgentMemory") ||
  mongoose.model<IAgentMemory>("AgentMemory", AgentMemorySchema);
