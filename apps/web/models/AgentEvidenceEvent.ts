import type {
  AgentActor,
  AgentSensitivity,
  AgentSourceRef,
  AgentSourceType,
  AgentTrust,
} from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";
import {
  AGENT_ACTORS,
  AGENT_SENSITIVITIES,
  AGENT_SOURCE_TYPES,
  AGENT_TRUST_LEVELS,
  AgentSourceRefSchema,
  existingModel,
} from "./AgentMemoryCommon";

export interface IAgentEvidenceEvent extends Document {
  eventId: string;
  idempotencyKey: string;
  sourceType: AgentSourceType;
  sourceRef: AgentSourceRef;
  sourceRevision?: string;
  contentHash: string;
  snapshot?: string;
  occurredAt: Date;
  observedAt: Date;
  timeRange?: { from: Date; until: Date; timezone?: string };
  actor: AgentActor;
  trust: AgentTrust;
  sensitivity: AgentSensitivity;
  memoryEligible: boolean;
  provenance: Record<string, unknown>;
  redactedAt?: Date;
  createdAt: Date;
}

const AgentEvidenceEventSchema = new Schema<IAgentEvidenceEvent>(
  {
    eventId: { type: String, required: true, immutable: true },
    idempotencyKey: {
      type: String,
      required: true,
      immutable: true,
      maxlength: 512,
    },
    sourceType: {
      type: String,
      enum: AGENT_SOURCE_TYPES,
      required: true,
      immutable: true,
    },
    sourceRef: { type: AgentSourceRefSchema, required: true, immutable: true },
    sourceRevision: { type: String, maxlength: 256, immutable: true },
    contentHash: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/,
      immutable: true,
    },
    snapshot: { type: String, maxlength: 8_192, immutable: true },
    occurredAt: { type: Date, required: true, immutable: true },
    observedAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
    timeRange: {
      type: new Schema(
        {
          from: { type: Date, required: true },
          until: { type: Date, required: true },
          timezone: { type: String, maxlength: 100 },
        },
        { _id: false },
      ),
      immutable: true,
    },
    actor: {
      type: String,
      enum: AGENT_ACTORS,
      required: true,
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
    memoryEligible: { type: Boolean, required: true, immutable: true },
    provenance: { type: Schema.Types.Mixed, required: true, default: {} },
    redactedAt: { type: Date },
  },
  {
    collection: "agent_evidence_events",
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
  },
);

AgentEvidenceEventSchema.index({ eventId: 1 }, { unique: true });
AgentEvidenceEventSchema.index({ idempotencyKey: 1 }, { unique: true });
AgentEvidenceEventSchema.index({ sourceType: 1, occurredAt: -1 });
AgentEvidenceEventSchema.index({
  "sourceRef.entityType": 1,
  "sourceRef.entityId": 1,
  occurredAt: -1,
});
AgentEvidenceEventSchema.index({
  memoryEligible: 1,
  redactedAt: 1,
  observedAt: 1,
});

export const AgentEvidenceEvent =
  existingModel<IAgentEvidenceEvent>("AgentEvidenceEvent") ||
  mongoose.model<IAgentEvidenceEvent>(
    "AgentEvidenceEvent",
    AgentEvidenceEventSchema,
  );
