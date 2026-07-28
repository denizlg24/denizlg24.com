import {
  type BackgroundAgentPageContext,
  type BackgroundAgentRunStatus,
  backgroundAgentRunStatusSchema,
  type IChatMessageAttachment,
} from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface IBackgroundAgentRun extends Document {
  conversationId: mongoose.Types.ObjectId;
  prompt: string;
  llmModel: string;
  pageContext?: BackgroundAgentPageContext;
  attachments: IChatMessageAttachment[];
  maxRounds: number;
  status: BackgroundAgentRunStatus;
  output?: string;
  tokenUsage?: { inputTokens: number; outputTokens: number; costUsd: number };
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TokenUsageSchema = new Schema(
  {
    inputTokens: { type: Number, min: 0, required: true },
    outputTokens: { type: Number, min: 0, required: true },
    costUsd: { type: Number, min: 0, required: true },
  },
  { _id: false },
);

const BackgroundAttachmentSchema = new Schema<IChatMessageAttachment>(
  {
    type: { type: String, enum: ["image", "pdf"], required: true },
    url: { type: String, required: true },
    name: { type: String, required: true },
  },
  { _id: false },
);

const BackgroundAgentRunSchema = new Schema<IBackgroundAgentRun>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    prompt: { type: String, maxlength: 32_000, default: "" },
    llmModel: { type: String, required: true, maxlength: 200 },
    pageContext: { type: Schema.Types.Mixed, default: undefined },
    attachments: { type: [BackgroundAttachmentSchema], default: [] },
    maxRounds: { type: Number, required: true, min: 1, max: 100 },
    status: {
      type: String,
      enum: backgroundAgentRunStatusSchema.options,
      default: "queued",
      required: true,
    },
    output: { type: String, maxlength: 64_000 },
    tokenUsage: { type: TokenUsageSchema, default: undefined },
    error: { type: String, maxlength: 4_096 },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  {
    collection: "background_agent_runs",
    timestamps: true,
    minimize: false,
  },
);

BackgroundAgentRunSchema.index({ status: 1, createdAt: -1 });
BackgroundAgentRunSchema.index({ conversationId: 1, createdAt: -1 });

export const BackgroundAgentRun =
  existingModel<IBackgroundAgentRun>("BackgroundAgentRun") ||
  mongoose.model<IBackgroundAgentRun>(
    "BackgroundAgentRun",
    BackgroundAgentRunSchema,
  );
