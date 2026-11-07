import type {
  RunConfig,
  SprintReleaseOffer,
  SprintStatus,
} from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export type SprintPrState = "draft" | "open" | "merged" | "closed";

export interface ISprintRelease {
  runId: string;
  sha: string;
  readyAt: Date;
  state: SprintReleaseOffer["state"];
  mergedAt?: Date;
  mergeSha?: string;
  error?: string;
}

export interface ISprint extends Document {
  title: string;
  goal: string;
  repo: string;
  baseBranch: string;
  branch: string;
  /** Always a full config; a slot's override is resolved on top of it. */
  defaults: RunConfig;
  prNumber?: number;
  prUrl?: string;
  prState?: SprintPrState;
  release?: ISprintRelease;
  status: SprintStatus;
  timeZone: string;
  branchLocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SprintReleaseSchema = new Schema<ISprintRelease>(
  {
    runId: { type: String, required: true },
    sha: { type: String, required: true },
    readyAt: { type: Date, required: true },
    state: {
      type: String,
      enum: ["ready", "merging", "merged", "failed"],
      required: true,
    },
    mergedAt: { type: Date },
    mergeSha: { type: String },
    error: { type: String, maxlength: 2_000 },
  },
  { _id: false },
);

const SprintSchema = new Schema<ISprint>(
  {
    title: { type: String, required: true, maxlength: 200 },
    goal: { type: String, default: "", maxlength: 20_000 },
    repo: { type: String, required: true },
    baseBranch: { type: String, required: true },
    branch: { type: String, required: true },
    defaults: { type: Schema.Types.Mixed, required: true },
    prNumber: { type: Number },
    prUrl: { type: String },
    prState: { type: String, enum: ["draft", "open", "merged", "closed"] },
    release: { type: SprintReleaseSchema, default: undefined },
    status: {
      type: String,
      enum: ["draft", "active", "completed", "cancelled"],
      default: "draft",
    },
    timeZone: { type: String, default: "UTC" },
    branchLocked: { type: Boolean, default: false },
  },
  { collection: "sprints", timestamps: true, minimize: false },
);

SprintSchema.index({ status: 1, updatedAt: -1 });
SprintSchema.index({ "release.state": 1 });

export const SprintModel =
  existingModel<ISprint>("Sprint") ||
  mongoose.model<ISprint>("Sprint", SprintSchema);
