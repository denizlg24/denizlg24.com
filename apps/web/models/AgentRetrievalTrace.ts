import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface IAgentRetrievalTrace extends Document {
  traceId: string;
  conversationId?: mongoose.Types.ObjectId;
  requestId?: string;
  purpose: string;
  query: string;
  filters: Record<string, unknown>;
  candidates: unknown[];
  exclusions: unknown[];
  selectedRevisionIds: mongoose.Types.ObjectId[];
  tokenBudget: number;
  estimatedTokens: number;
  injected: boolean;
  abstained: boolean;
  createdAt: Date;
}

const AgentRetrievalTraceSchema = new Schema<IAgentRetrievalTrace>(
  {
    traceId: { type: String, required: true, immutable: true },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      immutable: true,
    },
    requestId: { type: String, immutable: true },
    purpose: { type: String, required: true, immutable: true },
    query: { type: String, required: true, maxlength: 8_192, immutable: true },
    filters: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
      immutable: true,
    },
    candidates: { type: [Schema.Types.Mixed], default: [], immutable: true },
    exclusions: { type: [Schema.Types.Mixed], default: [], immutable: true },
    selectedRevisionIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "AgentMemoryRevision" }],
      default: [],
      immutable: true,
    },
    tokenBudget: { type: Number, required: true, min: 0, immutable: true },
    estimatedTokens: { type: Number, required: true, min: 0, immutable: true },
    injected: { type: Boolean, required: true, immutable: true },
    abstained: { type: Boolean, required: true, immutable: true },
  },
  {
    collection: "agent_retrieval_traces",
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
  },
);

AgentRetrievalTraceSchema.index({ traceId: 1 }, { unique: true });
AgentRetrievalTraceSchema.index({ conversationId: 1, createdAt: -1 });
AgentRetrievalTraceSchema.index({ createdAt: -1 });

export const AgentRetrievalTrace =
  existingModel<IAgentRetrievalTrace>("AgentRetrievalTrace") ||
  mongoose.model<IAgentRetrievalTrace>(
    "AgentRetrievalTrace",
    AgentRetrievalTraceSchema,
  );
