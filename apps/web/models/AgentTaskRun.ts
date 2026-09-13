import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

/**
 * The flattened audit shape runs were stored in before the transcript itself
 * was kept. Never written any more; `serializeAgentTaskRun` turns it back into
 * tool parts so an old run renders down the same path as a new one.
 */
export interface IAgentTaskLegacyToolCall {
  toolUseId: string;
  name: string;
  isWrite: boolean;
  input: Record<string, unknown>;
  result?: string;
  isError: boolean;
}

export interface IAgentTaskFeedback {
  feedbackId: string;
  verdict: "useful" | "correction";
  text?: string;
  learnedProcedureIds: mongoose.Types.ObjectId[];
  createdAt: Date;
}

export interface IAgentTaskRun extends Document {
  taskId: mongoose.Types.ObjectId;
  taskName: string;
  trigger: "scheduled" | "manual";
  status: "queued" | "running" | "completed" | "failed";
  scheduledFor: Date;
  startedAt?: Date;
  /**
   * Held by the worker executing the run and pushed forward on every job
   * heartbeat. A `running` row whose lease has lapsed is a dead worker; one
   * that is merely old is not.
   */
  executionLeaseExpiresAt?: Date;
  completedAt?: Date;
  output?: string;
  /** `AgentUIMessage[]`; persisted as the run progresses, not only at the end. */
  messages: unknown[];
  /** Kept on the row so the list can say it without loading the transcript. */
  toolCallCount: number;
  /** Only on rows written before `messages` existed. */
  toolCalls?: IAgentTaskLegacyToolCall[];
  tokenUsage?: { inputTokens: number; outputTokens: number; costUsd: number };
  feedback?: IAgentTaskFeedback;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AgentTaskLegacyToolCallSchema = new Schema<IAgentTaskLegacyToolCall>(
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

const AgentTaskFeedbackSchema = new Schema<IAgentTaskFeedback>(
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

const AgentTaskTokenUsageSchema = new Schema(
  {
    inputTokens: { type: Number, min: 0, required: true },
    outputTokens: { type: Number, min: 0, required: true },
    costUsd: { type: Number, min: 0, required: true },
  },
  { _id: false },
);

const AgentTaskRunSchema = new Schema<IAgentTaskRun>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: "AgentTask", required: true },
    taskName: { type: String, required: true, maxlength: 160 },
    trigger: { type: String, enum: ["scheduled", "manual"], required: true },
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed"],
      default: "queued",
    },
    scheduledFor: { type: Date, required: true },
    startedAt: { type: Date },
    executionLeaseExpiresAt: { type: Date },
    completedAt: { type: Date },
    output: { type: String, maxlength: 64_000 },
    messages: { type: [Schema.Types.Mixed], default: [] },
    toolCallCount: { type: Number, min: 0, default: 0 },
    toolCalls: { type: [AgentTaskLegacyToolCallSchema], default: undefined },
    tokenUsage: { type: AgentTaskTokenUsageSchema, default: undefined },
    feedback: { type: AgentTaskFeedbackSchema },
    error: { type: String, maxlength: 4_096 },
  },
  { collection: "agent_task_runs", timestamps: true, minimize: false },
);

AgentTaskRunSchema.index({ taskId: 1, scheduledFor: 1 }, { unique: true });
AgentTaskRunSchema.index({ status: 1, createdAt: -1 });
AgentTaskRunSchema.index(
  { "feedback.feedbackId": 1 },
  { unique: true, sparse: true },
);

export const AgentTaskRun =
  existingModel<IAgentTaskRun>("AgentTaskRun") ||
  mongoose.model<IAgentTaskRun>("AgentTaskRun", AgentTaskRunSchema);
