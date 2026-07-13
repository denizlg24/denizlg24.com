import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface IAgentFeedbackEvent extends Document {
  eventId: string;
  idempotencyKey: string;
  kind:
    | "correction"
    | "useful"
    | "not-relevant"
    | "forget"
    | "tool-approved"
    | "tool-denied"
    | "tool-failed"
    | "tool-undone"
    | "suggestion-accepted"
    | "suggestion-dismissed"
    | "draft-edited";
  conversationId?: mongoose.Types.ObjectId;
  requestId?: string;
  outputId?: string;
  toolCallId?: string;
  memoryIds: mongoose.Types.ObjectId[];
  evidenceIds: string[];
  boundedDiff?: Record<string, unknown>;
  createdAt: Date;
}

const AgentFeedbackEventSchema = new Schema<IAgentFeedbackEvent>(
  {
    eventId: { type: String, required: true, immutable: true },
    idempotencyKey: { type: String, required: true, immutable: true },
    kind: {
      type: String,
      enum: [
        "correction",
        "useful",
        "not-relevant",
        "forget",
        "tool-approved",
        "tool-denied",
        "tool-failed",
        "tool-undone",
        "suggestion-accepted",
        "suggestion-dismissed",
        "draft-edited",
      ],
      required: true,
      immutable: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      immutable: true,
    },
    requestId: { type: String, immutable: true },
    outputId: { type: String, immutable: true },
    toolCallId: { type: String, immutable: true },
    memoryIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "AgentMemory" }],
      default: [],
      immutable: true,
    },
    evidenceIds: { type: [String], default: [], immutable: true },
    boundedDiff: { type: Schema.Types.Mixed, immutable: true },
  },
  {
    collection: "agent_feedback_events",
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
  },
);

AgentFeedbackEventSchema.index({ eventId: 1 }, { unique: true });
AgentFeedbackEventSchema.index({ idempotencyKey: 1 }, { unique: true });
AgentFeedbackEventSchema.index({ kind: 1, createdAt: -1 });

export const AgentFeedbackEvent =
  existingModel<IAgentFeedbackEvent>("AgentFeedbackEvent") ||
  mongoose.model<IAgentFeedbackEvent>(
    "AgentFeedbackEvent",
    AgentFeedbackEventSchema,
  );
