import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface IAgentTrainingToolCall {
  toolUseId: string;
  name: string;
  isWrite: boolean;
  input: Record<string, unknown>;
  result?: string;
  isError: boolean;
}

export interface IAgentTrainingFeedback {
  feedbackId: string;
  verdict: "useful" | "correction";
  text?: string;
  learnedProcedureIds: mongoose.Types.ObjectId[];
  createdAt: Date;
}

export interface IAgentTrainingRun extends Document {
  taskId: mongoose.Types.ObjectId;
  taskName: string;
  trigger: "scheduled" | "manual";
  status:
    | "queued"
    | "running"
    | "awaiting-feedback"
    | "learning"
    | "completed"
    | "failed";
  scheduledFor: Date;
  startedAt?: Date;
  completedAt?: Date;
  output?: string;
  toolCalls: IAgentTrainingToolCall[];
  tokenUsage?: { inputTokens: number; outputTokens: number; costUsd: number };
  feedback?: IAgentTrainingFeedback;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AgentTrainingToolCallSchema = new Schema<IAgentTrainingToolCall>(
  {
    toolUseId: { type: String, required: true },
    name: { type: String, required: true },
    isWrite: { type: Boolean, required: true },
    input: { type: Schema.Types.Mixed, required: true },
    result: { type: String, maxlength: 16_000 },
    isError: { type: Boolean, required: true, default: false },
  },
  { _id: false, minimize: false },
);

const AgentTrainingFeedbackSchema = new Schema<IAgentTrainingFeedback>(
  {
    feedbackId: { type: String, required: true },
    verdict: { type: String, enum: ["useful", "correction"], required: true },
    text: { type: String, maxlength: 16_000 },
    learnedProcedureIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "AgentProcedure" }],
      default: [],
    },
    createdAt: { type: Date, required: true },
  },
  { _id: false },
);

const AgentTrainingTokenUsageSchema = new Schema(
  {
    inputTokens: { type: Number, min: 0, required: true },
    outputTokens: { type: Number, min: 0, required: true },
    costUsd: { type: Number, min: 0, required: true },
  },
  { _id: false },
);

const AgentTrainingRunSchema = new Schema<IAgentTrainingRun>(
  {
    taskId: {
      type: Schema.Types.ObjectId,
      ref: "AgentTrainingTask",
      required: true,
    },
    taskName: { type: String, required: true, maxlength: 160 },
    trigger: { type: String, enum: ["scheduled", "manual"], required: true },
    status: {
      type: String,
      enum: [
        "queued",
        "running",
        "awaiting-feedback",
        "learning",
        "completed",
        "failed",
      ],
      default: "queued",
    },
    scheduledFor: { type: Date, required: true },
    startedAt: { type: Date },
    completedAt: { type: Date },
    output: { type: String, maxlength: 64_000 },
    toolCalls: { type: [AgentTrainingToolCallSchema], default: [] },
    tokenUsage: {
      type: AgentTrainingTokenUsageSchema,
      default: undefined,
    },
    feedback: { type: AgentTrainingFeedbackSchema },
    error: { type: String, maxlength: 4_096 },
  },
  { collection: "agent_training_runs", timestamps: true, minimize: false },
);

AgentTrainingRunSchema.index({ taskId: 1, scheduledFor: 1 }, { unique: true });
AgentTrainingRunSchema.index({ status: 1, createdAt: -1 });
AgentTrainingRunSchema.index(
  { "feedback.feedbackId": 1 },
  { unique: true, sparse: true },
);

export const AgentTrainingRun =
  existingModel<IAgentTrainingRun>("AgentTrainingRun") ||
  mongoose.model<IAgentTrainingRun>("AgentTrainingRun", AgentTrainingRunSchema);
