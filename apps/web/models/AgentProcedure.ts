import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface IAgentProcedure extends Document {
  lifecycle: "candidate" | "testing" | "active" | "retired";
  scope: string;
  trigger: string;
  behavior: string;
  exceptions: string[];
  supportingFeedbackIds: mongoose.Types.ObjectId[];
  evidenceIds: string[];
  confidence: number;
  explicit: boolean;
  promotionReason?: string;
  retirementReason?: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const AgentProcedureSchema = new Schema<IAgentProcedure>(
  {
    lifecycle: {
      type: String,
      enum: ["candidate", "testing", "active", "retired"],
      default: "candidate",
    },
    scope: { type: String, required: true, maxlength: 1_000 },
    trigger: { type: String, required: true, maxlength: 2_000 },
    behavior: { type: String, required: true, maxlength: 4_096 },
    exceptions: { type: [String], default: [] },
    supportingFeedbackIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "AgentFeedbackEvent" }],
      default: [],
    },
    evidenceIds: { type: [String], required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    explicit: { type: Boolean, required: true, default: false },
    promotionReason: { type: String, maxlength: 2_000 },
    retirementReason: { type: String, maxlength: 2_000 },
    revision: { type: Number, required: true, default: 1, min: 1 },
  },
  { collection: "agent_procedures", timestamps: true },
);

AgentProcedureSchema.index({ lifecycle: 1, scope: 1, confidence: -1 });
AgentProcedureSchema.index({ lifecycle: 1, confidence: -1, updatedAt: -1 });
AgentProcedureSchema.index({ evidenceIds: 1, lifecycle: 1 });

export const AgentProcedure =
  existingModel<IAgentProcedure>("AgentProcedure") ||
  mongoose.model<IAgentProcedure>("AgentProcedure", AgentProcedureSchema);
