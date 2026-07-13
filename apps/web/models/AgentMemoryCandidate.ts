import type {
  AgentEntityRef,
  AgentExplicitness,
  AgentMemoryType,
  AgentSensitivity,
  AgentTemporal,
  AgentTrust,
} from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";
import {
  AGENT_EXPLICITNESS,
  AGENT_MEMORY_TYPES,
  AGENT_SENSITIVITIES,
  AGENT_TRUST_LEVELS,
  AgentEntityRefSchema,
  AgentTemporalSchema,
  existingModel,
} from "./AgentMemoryCommon";

export interface IAgentMemoryCandidate extends Document {
  candidateKey: string;
  statement: string;
  memoryType: AgentMemoryType;
  explicitness: AgentExplicitness;
  confidence: number;
  importance: number;
  trust: AgentTrust;
  sensitivity: AgentSensitivity;
  temporal: AgentTemporal;
  entityRefs: AgentEntityRef[];
  evidenceIds: string[];
  contradictionEvidenceIds: string[];
  conflictingMemoryIds: mongoose.Types.ObjectId[];
  extraction: {
    model: string;
    promptVersion: string;
    schemaVersion: string;
    inputHash: string;
    runId: mongoose.Types.ObjectId;
  };
  reason: string;
  status: "pending" | "accepted" | "dismissed" | "superseded";
  reviewFlags: string[];
  decidedBy?: "user" | "policy";
  decidedAt?: Date;
  resultingMemoryId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AgentMemoryCandidateSchema = new Schema<IAgentMemoryCandidate>(
  {
    candidateKey: {
      type: String,
      required: true,
      immutable: true,
      maxlength: 64,
    },
    statement: { type: String, required: true, maxlength: 8_192 },
    memoryType: { type: String, enum: AGENT_MEMORY_TYPES, required: true },
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
    contradictionEvidenceIds: { type: [String], default: [] },
    conflictingMemoryIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "AgentMemory" }],
      default: [],
    },
    extraction: {
      type: new Schema(
        {
          model: { type: String, required: true },
          promptVersion: { type: String, required: true },
          schemaVersion: { type: String, required: true },
          inputHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
          runId: {
            type: Schema.Types.ObjectId,
            ref: "AgentMemoryRun",
            required: true,
          },
        },
        { _id: false },
      ),
      required: true,
    },
    reason: { type: String, required: true, maxlength: 4_096 },
    status: {
      type: String,
      enum: ["pending", "accepted", "dismissed", "superseded"],
      default: "pending",
    },
    reviewFlags: { type: [String], default: [] },
    decidedBy: { type: String, enum: ["user", "policy"] },
    decidedAt: { type: Date },
    resultingMemoryId: { type: Schema.Types.ObjectId, ref: "AgentMemory" },
  },
  { collection: "agent_memory_candidates", timestamps: true },
);

AgentMemoryCandidateSchema.index({ status: 1, reviewFlags: 1, createdAt: -1 });
AgentMemoryCandidateSchema.index({ candidateKey: 1 }, { unique: true });
AgentMemoryCandidateSchema.index({ evidenceIds: 1, status: 1 });
AgentMemoryCandidateSchema.index({ memoryType: 1, status: 1, confidence: -1 });
AgentMemoryCandidateSchema.index({
  "entityRefs.entityType": 1,
  "entityRefs.entityId": 1,
  status: 1,
});

export const AgentMemoryCandidate =
  existingModel<IAgentMemoryCandidate>("AgentMemoryCandidate") ||
  mongoose.model<IAgentMemoryCandidate>(
    "AgentMemoryCandidate",
    AgentMemoryCandidateSchema,
  );
