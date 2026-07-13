import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface IAgentMemoryJob extends Document {
  idempotencyKey: string;
  operation: "formation" | "reflection" | "embedding" | "backfill" | "deletion";
  evidenceIds: string[];
  memoryIds: mongoose.Types.ObjectId[];
  status:
    | "pending"
    | "leased"
    | "completed"
    | "retry"
    | "dead-letter"
    | "cancelled";
  attempts: number;
  availableAt: Date;
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  lastError?: string;
  checkpoint?: Record<string, unknown>;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AgentMemoryJobSchema = new Schema<IAgentMemoryJob>(
  {
    idempotencyKey: { type: String, required: true, maxlength: 512 },
    operation: {
      type: String,
      enum: ["formation", "reflection", "embedding", "backfill", "deletion"],
      required: true,
    },
    evidenceIds: { type: [String], default: [] },
    memoryIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "AgentMemory" }],
      default: [],
    },
    status: {
      type: String,
      enum: [
        "pending",
        "leased",
        "completed",
        "retry",
        "dead-letter",
        "cancelled",
      ],
      default: "pending",
    },
    attempts: { type: Number, default: 0, min: 0 },
    availableAt: { type: Date, default: Date.now },
    leaseOwner: { type: String },
    leaseExpiresAt: { type: Date },
    lastError: { type: String, maxlength: 4_096 },
    checkpoint: { type: Schema.Types.Mixed },
    completedAt: { type: Date },
  },
  { collection: "agent_memory_jobs", timestamps: true, minimize: false },
);

AgentMemoryJobSchema.index({ idempotencyKey: 1 }, { unique: true });
AgentMemoryJobSchema.index({ status: 1, availableAt: 1, leaseExpiresAt: 1 });
AgentMemoryJobSchema.index({ operation: 1, status: 1, createdAt: 1 });

export const AgentMemoryJob =
  existingModel<IAgentMemoryJob>("AgentMemoryJob") ||
  mongoose.model<IAgentMemoryJob>("AgentMemoryJob", AgentMemoryJobSchema);
