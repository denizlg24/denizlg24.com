import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface IAgentTrainingAttachment {
  id: string;
  name: string;
  url: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  size: number;
}

export interface IAgentTrainingTask extends Document {
  name: string;
  prompt: string;
  attachments: IAgentTrainingAttachment[];
  timeOfDay: string;
  timeZone: string;
  llmModel: string;
  status: "active" | "paused" | "archived";
  autonomy: "yolo";
  nextRunAt?: Date;
  lastRunAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AgentTrainingAttachmentSchema = new Schema<IAgentTrainingAttachment>(
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

const AgentTrainingTaskSchema = new Schema<IAgentTrainingTask>(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    prompt: { type: String, required: true, trim: true, maxlength: 32_000 },
    attachments: {
      type: [AgentTrainingAttachmentSchema],
      default: [],
      validate: [
        (value: unknown[]) => value.length <= 10,
        "Too many attachments",
      ],
    },
    timeOfDay: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    timeZone: { type: String, required: true, maxlength: 100 },
    llmModel: { type: String, required: true, maxlength: 200 },
    status: {
      type: String,
      enum: ["active", "paused", "archived"],
      default: "active",
    },
    autonomy: { type: String, enum: ["yolo"], default: "yolo" },
    nextRunAt: { type: Date },
    lastRunAt: { type: Date },
  },
  { collection: "agent_training_tasks", timestamps: true },
);

AgentTrainingTaskSchema.index({ status: 1, nextRunAt: 1 });
AgentTrainingTaskSchema.index({ updatedAt: -1 });

export const AgentTrainingTask =
  existingModel<IAgentTrainingTask>("AgentTrainingTask") ||
  mongoose.model<IAgentTrainingTask>(
    "AgentTrainingTask",
    AgentTrainingTaskSchema,
  );
