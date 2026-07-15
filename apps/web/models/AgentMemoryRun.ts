import mongoose, { Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface IAgentMemoryRun {
  operation:
    | "formation"
    | "consolidation"
    | "reflection"
    | "evaluation"
    | "backfill"
    | "insight"
    | "resource-suggestion";
  status: "running" | "completed" | "failed" | "cancelled";
  model?: string;
  promptVersion: string;
  schemaVersion: string;
  inputIds: string[];
  outputIds: string[];
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AgentMemoryRunSchema = new Schema<IAgentMemoryRun>(
  {
    operation: {
      type: String,
      enum: [
        "formation",
        "consolidation",
        "reflection",
        "evaluation",
        "backfill",
        "insight",
        "resource-suggestion",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["running", "completed", "failed", "cancelled"],
      default: "running",
    },
    model: { type: String },
    promptVersion: { type: String, required: true },
    schemaVersion: { type: String, required: true },
    inputIds: { type: [String], default: [] },
    outputIds: { type: [String], default: [] },
    usage: {
      inputTokens: { type: Number, min: 0 },
      outputTokens: { type: Number, min: 0 },
      costUsd: { type: Number, min: 0 },
    },
    error: { type: String, maxlength: 4_096 },
    startedAt: { type: Date, required: true, default: Date.now },
    completedAt: { type: Date },
  },
  { collection: "agent_memory_runs", timestamps: true },
);

AgentMemoryRunSchema.index({ operation: 1, status: 1, startedAt: -1 });
AgentMemoryRunSchema.index({ startedAt: -1 });

export const AgentMemoryRun =
  existingModel<IAgentMemoryRun>("AgentMemoryRun") ||
  mongoose.model<IAgentMemoryRun>("AgentMemoryRun", AgentMemoryRunSchema);
