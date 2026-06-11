import mongoose from "mongoose";

export interface ILlmUsage extends mongoose.Document {
  llmModel: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  systemPrompt: string;
  userPrompt: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanLlmUsage {
  _id: string;
  llmModel: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  systemPrompt: string;
  userPrompt: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

const LlmUsageSchema = new mongoose.Schema<ILlmUsage>(
  {
    llmModel: { type: String, required: true },
    inputTokens: { type: Number, required: true },
    outputTokens: { type: Number, required: true },
    costUsd: { type: Number, required: true },
    systemPrompt: { type: String, required: true },
    userPrompt: { type: String, required: true },
    source: { type: String, required: true },
  },
  { timestamps: true },
);

LlmUsageSchema.index({ source: 1 });
LlmUsageSchema.index({ createdAt: -1 });

export const LlmUsage: mongoose.Model<ILlmUsage> =
  mongoose.models.LlmUsage ||
  mongoose.model<ILlmUsage>("LlmUsage", LlmUsageSchema);
