import type { AgentSourceRef, AgentSourceType } from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";
import { AGENT_MEMORY_VECTOR_CONFIG } from "@/lib/agent-memory/vector-config";
import {
  AGENT_SOURCE_TYPES,
  AgentSourceRefSchema,
  existingModel,
} from "./AgentMemoryCommon";

export interface IAgentMemorySettings extends Document<string> {
  _id: "singleton";
  releaseGates: {
    evidenceLedger: boolean;
    formation: boolean;
    shadowRetrieval: boolean;
    chatMemory: boolean;
    reflection: boolean;
    proactivity: boolean;
  };
  gateVerifications: Record<
    string,
    {
      verifiedAt: Date;
      verifiedBy: "owner";
      sampleSize: number;
      hardGatesPassed: boolean;
      notes: string;
      metrics: Record<string, number>;
    }
  >;
  enabledSources: AgentSourceType[];
  excludedSourceRefs: AgentSourceRef[];
  retrieval: {
    maxCoreItems: number;
    maxRetrievedItems: number;
    maxTokens: number;
    embeddingModel: string | null;
    embeddingDimensions: number | null;
    vectorIndex: string | null;
  };
  retention: { terminalJobDays: number; retrievalTraceDays: number };
  reflectionSchedule: string | null;
  proactivity: {
    enabledCategories: string[];
    maxInsightsPerDay: number;
    externalDelivery: boolean;
  };
  promotion: {
    mode: "conservative" | "single-user";
    emailReviewMaxConfidence: number;
  };
  formationModel: string | null;
  maximumActionAutonomy: "prepare-only";
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_AGENT_MEMORY_SETTINGS = {
  _id: "singleton" as const,
  releaseGates: {
    evidenceLedger: false,
    formation: false,
    shadowRetrieval: false,
    chatMemory: false,
    reflection: false,
    proactivity: false,
  },
  gateVerifications: {},
  enabledSources: [...AGENT_SOURCE_TYPES],
  excludedSourceRefs: [],
  retrieval: {
    maxCoreItems: 8,
    maxRetrievedItems: 12,
    maxTokens: 2_500,
    embeddingModel: AGENT_MEMORY_VECTOR_CONFIG.model,
    embeddingDimensions: AGENT_MEMORY_VECTOR_CONFIG.dimensions,
    vectorIndex: AGENT_MEMORY_VECTOR_CONFIG.indexName,
  },
  retention: { terminalJobDays: 30, retrievalTraceDays: 90 },
  reflectionSchedule: null,
  proactivity: {
    enabledCategories: [],
    maxInsightsPerDay: 5,
    externalDelivery: false,
  },
  promotion: {
    mode: "single-user" as const,
    emailReviewMaxConfidence: 0.7,
  },
  formationModel: null,
  maximumActionAutonomy: "prepare-only" as const,
  revision: 1,
};

const AgentMemorySettingsSchema = new Schema<IAgentMemorySettings>(
  {
    _id: { type: String, default: "singleton" },
    releaseGates: {
      evidenceLedger: { type: Boolean, default: false },
      formation: { type: Boolean, default: false },
      shadowRetrieval: { type: Boolean, default: false },
      chatMemory: { type: Boolean, default: false },
      reflection: { type: Boolean, default: false },
      proactivity: { type: Boolean, default: false },
    },
    gateVerifications: { type: Schema.Types.Mixed, default: {} },
    enabledSources: {
      type: [{ type: String, enum: AGENT_SOURCE_TYPES }],
      default: () => [...AGENT_SOURCE_TYPES],
    },
    excludedSourceRefs: { type: [AgentSourceRefSchema], default: [] },
    retrieval: {
      maxCoreItems: { type: Number, default: 8, min: 0, max: 20 },
      maxRetrievedItems: { type: Number, default: 12, min: 0, max: 50 },
      maxTokens: { type: Number, default: 2_500, min: 0, max: 10_000 },
      embeddingModel: {
        type: String,
        default: AGENT_MEMORY_VECTOR_CONFIG.model,
      },
      embeddingDimensions: {
        type: Number,
        default: AGENT_MEMORY_VECTOR_CONFIG.dimensions,
        min: 1,
        max: 4_096,
      },
      vectorIndex: {
        type: String,
        default: AGENT_MEMORY_VECTOR_CONFIG.indexName,
      },
    },
    retention: {
      terminalJobDays: { type: Number, default: 30, min: 1, max: 365 },
      retrievalTraceDays: { type: Number, default: 90, min: 1, max: 365 },
    },
    reflectionSchedule: { type: String, default: null },
    proactivity: {
      enabledCategories: { type: [String], default: [] },
      maxInsightsPerDay: { type: Number, default: 5, min: 0, max: 100 },
      externalDelivery: { type: Boolean, default: false },
    },
    promotion: {
      mode: {
        type: String,
        enum: ["conservative", "single-user"],
        default: "single-user",
      },
      emailReviewMaxConfidence: { type: Number, default: 0.7, min: 0, max: 1 },
    },
    formationModel: { type: String, default: null, maxlength: 200 },
    maximumActionAutonomy: {
      type: String,
      enum: ["prepare-only"],
      default: "prepare-only",
    },
    revision: { type: Number, default: 1, min: 1 },
  },
  { collection: "agent_memory_settings", timestamps: true, minimize: false },
);

export const AgentMemorySettings =
  existingModel<IAgentMemorySettings>("AgentMemorySettings") ||
  mongoose.model<IAgentMemorySettings>(
    "AgentMemorySettings",
    AgentMemorySettingsSchema,
  );
