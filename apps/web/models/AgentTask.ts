import type { AgentMemoryMode } from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface IAgentTaskAttachment {
  id: string;
  name: string;
  url: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  size: number;
}

export interface IAgentTaskSchedule {
  cron: string;
  timeZone: string;
}

export interface IAgentTask extends Document {
  name: string;
  prompt: string;
  attachments: IAgentTaskAttachment[];
  /** Absent means manual-only: the task runs on demand and the scheduler skips it. */
  schedule?: IAgentTaskSchedule;
  llmModel: string;
  memoryMode: AgentMemoryMode;
  status: "active" | "paused" | "archived";
  maxRounds: number;
  nextRunAt?: Date;
  lastRunAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AgentTaskAttachmentSchema = new Schema<IAgentTaskAttachment>(
  {
    id: { type: String, required: true, maxlength: 512 },
    name: { type: String, required: true, maxlength: 256 },
    url: { type: String, required: true, maxlength: 4_096 },
    mimeType: {
      type: String,
      required: true,
      enum: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    },
    size: { type: Number, required: true, min: 0, max: 10 * 1024 * 1024 },
  },
  { _id: false },
);

const AgentTaskScheduleSchema = new Schema<IAgentTaskSchedule>(
  {
    cron: { type: String, required: true, maxlength: 120 },
    timeZone: { type: String, required: true, maxlength: 100 },
  },
  { _id: false },
);

const AgentTaskSchema = new Schema<IAgentTask>(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    prompt: { type: String, required: true, trim: true, maxlength: 32_000 },
    attachments: {
      type: [AgentTaskAttachmentSchema],
      default: [],
      validate: [
        (value: unknown[]) => value.length <= 10,
        "Too many attachments",
      ],
    },
    schedule: { type: AgentTaskScheduleSchema, default: undefined },
    llmModel: { type: String, required: true, maxlength: 200 },
    memoryMode: {
      type: String,
      enum: ["enabled", "retrieval-off", "incognito"],
      default: "enabled",
    },
    status: {
      type: String,
      enum: ["active", "paused", "archived"],
      default: "active",
    },
    maxRounds: { type: Number, default: 40, min: 1, max: 200 },
    nextRunAt: { type: Date },
    lastRunAt: { type: Date },
  },
  { collection: "agent_tasks", timestamps: true },
);

AgentTaskSchema.index({ status: 1, nextRunAt: 1 });
AgentTaskSchema.index({ updatedAt: -1 });

export const AgentTask =
  existingModel<IAgentTask>("AgentTask") ||
  mongoose.model<IAgentTask>("AgentTask", AgentTaskSchema);
