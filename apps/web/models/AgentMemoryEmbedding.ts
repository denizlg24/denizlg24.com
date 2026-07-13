import type { AgentMemoryStatus, AgentMemoryType } from "@repo/schemas";
import mongoose, { Schema } from "mongoose";
import {
  AGENT_MEMORY_STATUSES,
  AGENT_MEMORY_TYPES,
  AGENT_SENSITIVITIES,
  existingModel,
} from "./AgentMemoryCommon";

export interface IAgentMemoryEmbedding {
  memoryId: mongoose.Types.ObjectId;
  memoryRevisionId: mongoose.Types.ObjectId;
  model: string;
  dimensions: number;
  vector: number[];
  contentHash: string;
  sensitivity: string;
  status: AgentMemoryStatus;
  memoryType: AgentMemoryType;
  validUntil: Date | null;
  createdAt: Date;
}

const AgentMemoryEmbeddingSchema = new Schema<IAgentMemoryEmbedding>(
  {
    memoryId: {
      type: Schema.Types.ObjectId,
      ref: "AgentMemory",
      required: true,
    },
    memoryRevisionId: {
      type: Schema.Types.ObjectId,
      ref: "AgentMemoryRevision",
      required: true,
    },
    model: { type: String, required: true },
    dimensions: { type: Number, required: true, min: 1, max: 4_096 },
    vector: { type: [Number], required: true, select: false },
    contentHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    sensitivity: { type: String, enum: AGENT_SENSITIVITIES, required: true },
    status: { type: String, enum: AGENT_MEMORY_STATUSES, required: true },
    memoryType: { type: String, enum: AGENT_MEMORY_TYPES, required: true },
    validUntil: { type: Date, default: null },
  },
  {
    collection: "agent_memory_embeddings",
    timestamps: { createdAt: true, updatedAt: false },
  },
);

AgentMemoryEmbeddingSchema.index(
  { memoryRevisionId: 1, model: 1 },
  { unique: true },
);
AgentMemoryEmbeddingSchema.index({ memoryId: 1, createdAt: -1 });

export const AgentMemoryEmbedding =
  existingModel<IAgentMemoryEmbedding>("AgentMemoryEmbedding") ||
  mongoose.model<IAgentMemoryEmbedding>(
    "AgentMemoryEmbedding",
    AgentMemoryEmbeddingSchema,
  );
