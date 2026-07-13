import type { AgentEntityRef, AgentSourceRef } from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";
import {
  AgentEntityRefSchema,
  AgentSourceRefSchema,
  existingModel,
} from "./AgentMemoryCommon";

export interface IAgentGoal extends Document {
  title: string;
  description?: string;
  kind: "goal" | "user-commitment" | "agent-follow-up";
  status: "suggested" | "active" | "paused" | "completed" | "abandoned";
  motivation?: string;
  targetFrom?: Date;
  targetUntil?: Date;
  constraints: string[];
  dependencyIds: mongoose.Types.ObjectId[];
  progressEvidenceIds: string[];
  relatedEntities: AgentEntityRef[];
  pauseOrAbandonReason?: string;
  provenance: AgentSourceRef;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const AgentGoalSchema = new Schema<IAgentGoal>(
  {
    title: { type: String, required: true, maxlength: 512 },
    description: { type: String, maxlength: 4_096 },
    kind: {
      type: String,
      enum: ["goal", "user-commitment", "agent-follow-up"],
      required: true,
    },
    status: {
      type: String,
      enum: ["suggested", "active", "paused", "completed", "abandoned"],
      default: "suggested",
    },
    motivation: { type: String, maxlength: 2_000 },
    targetFrom: { type: Date },
    targetUntil: { type: Date },
    constraints: { type: [String], default: [] },
    dependencyIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "AgentGoal" }],
      default: [],
    },
    progressEvidenceIds: { type: [String], default: [] },
    relatedEntities: { type: [AgentEntityRefSchema], default: [] },
    pauseOrAbandonReason: { type: String, maxlength: 2_000 },
    provenance: { type: AgentSourceRefSchema, required: true },
    revision: { type: Number, required: true, default: 1, min: 1 },
  },
  { collection: "agent_goals", timestamps: true },
);

AgentGoalSchema.index({ status: 1, targetUntil: 1 });
AgentGoalSchema.index({ kind: 1, status: 1, updatedAt: -1 });
AgentGoalSchema.index({
  "relatedEntities.entityType": 1,
  "relatedEntities.entityId": 1,
  status: 1,
});

export const AgentGoal =
  existingModel<IAgentGoal>("AgentGoal") ||
  mongoose.model<IAgentGoal>("AgentGoal", AgentGoalSchema);
