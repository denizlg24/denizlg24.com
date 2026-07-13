import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface IAgentUserModelRevision extends Document {
  revision: number;
  sections: Record<string, unknown[]>;
  sourceMemoryRevision: number;
  changedMemoryIds: mongoose.Types.ObjectId[];
  reason: string;
  createdBy: "user" | "policy" | "reflection" | "rollback";
  createdAt: Date;
}

const AgentUserModelRevisionSchema = new Schema<IAgentUserModelRevision>(
  {
    revision: { type: Number, required: true, min: 1, immutable: true },
    sections: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
      immutable: true,
    },
    sourceMemoryRevision: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
    },
    changedMemoryIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "AgentMemory" }],
      default: [],
      immutable: true,
    },
    reason: { type: String, required: true, maxlength: 4_096, immutable: true },
    createdBy: {
      type: String,
      enum: ["user", "policy", "reflection", "rollback"],
      required: true,
      immutable: true,
    },
  },
  {
    collection: "agent_user_model_revisions",
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
  },
);

AgentUserModelRevisionSchema.index({ revision: 1 }, { unique: true });
AgentUserModelRevisionSchema.index({ createdAt: -1 });

export const AgentUserModelRevision =
  existingModel<IAgentUserModelRevision>("AgentUserModelRevision") ||
  mongoose.model<IAgentUserModelRevision>(
    "AgentUserModelRevision",
    AgentUserModelRevisionSchema,
  );
