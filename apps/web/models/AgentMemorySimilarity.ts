import mongoose, { Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface IAgentMemorySimilarity {
  /** `${lowerMemoryId}:${higherMemoryId}` — one link per unordered pair. */
  pairKey: string;
  sourceMemoryId: mongoose.Types.ObjectId;
  targetMemoryId: mongoose.Types.ObjectId;
  /** Cosine similarity in [0, 1]. */
  strength: number;
  model: string;
  createdAt: Date;
  updatedAt: Date;
}

const AgentMemorySimilaritySchema = new Schema<IAgentMemorySimilarity>(
  {
    pairKey: { type: String, required: true },
    sourceMemoryId: {
      type: Schema.Types.ObjectId,
      ref: "AgentMemory",
      required: true,
    },
    targetMemoryId: {
      type: Schema.Types.ObjectId,
      ref: "AgentMemory",
      required: true,
    },
    strength: { type: Number, required: true, min: 0, max: 1 },
    model: { type: String, required: true },
  },
  { collection: "agent_memory_similarities", timestamps: true },
);

AgentMemorySimilaritySchema.index({ pairKey: 1 }, { unique: true });
AgentMemorySimilaritySchema.index({ sourceMemoryId: 1 });
AgentMemorySimilaritySchema.index({ targetMemoryId: 1 });

export const AgentMemorySimilarity =
  existingModel<IAgentMemorySimilarity>("AgentMemorySimilarity") ||
  mongoose.model<IAgentMemorySimilarity>(
    "AgentMemorySimilarity",
    AgentMemorySimilaritySchema,
  );
