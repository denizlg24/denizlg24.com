import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface IAgentInsight extends Document {
  idempotencyKey: string;
  category: string;
  status: "pending" | "delivered" | "dismissed" | "snoozed" | "expired";
  title: string;
  body: string;
  triggerEvidenceIds: string[];
  reason: string;
  proposedAction?: Record<string, unknown>;
  expectedUsefulness: number;
  urgency: number;
  confidence: number;
  interruptionCost: number;
  delivery: "in-app" | "silent-draft";
  expiresAt: Date;
  snoozedUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AgentInsightSchema = new Schema<IAgentInsight>(
  {
    idempotencyKey: { type: String, required: true },
    category: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "delivered", "dismissed", "snoozed", "expired"],
      default: "pending",
    },
    title: { type: String, required: true, maxlength: 512 },
    body: { type: String, required: true, maxlength: 4_096 },
    triggerEvidenceIds: { type: [String], required: true },
    reason: { type: String, required: true, maxlength: 2_000 },
    proposedAction: { type: Schema.Types.Mixed },
    expectedUsefulness: { type: Number, required: true, min: 0, max: 1 },
    urgency: { type: Number, required: true, min: 0, max: 1 },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    interruptionCost: { type: Number, required: true, min: 0, max: 1 },
    delivery: {
      type: String,
      enum: ["in-app", "silent-draft"],
      required: true,
    },
    expiresAt: { type: Date, required: true },
    snoozedUntil: { type: Date },
  },
  { collection: "agent_insights", timestamps: true, minimize: false },
);

AgentInsightSchema.index({ idempotencyKey: 1 }, { unique: true });
AgentInsightSchema.index({ status: 1, expiresAt: 1, createdAt: -1 });
AgentInsightSchema.index({ category: 1, createdAt: -1 });

export const AgentInsight =
  existingModel<IAgentInsight>("AgentInsight") ||
  mongoose.model<IAgentInsight>("AgentInsight", AgentInsightSchema);
