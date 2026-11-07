import type {
  RunConfigOverride,
  SlotSkipReason,
  SprintSlotKind,
  SprintSlotStatus,
} from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface ISprintSlot extends Document {
  sprintId: mongoose.Types.ObjectId;
  at: Date;
  kind: SprintSlotKind;
  title: string;
  task: string;
  config: RunConfigOverride;
  /** Slot ids as strings, all within the same sprint. */
  dependsOn: string[];
  onUpstreamRunning: { waitMinutes: number };
  status: SprintSlotStatus;
  skipReason?: SlotSkipReason;
  lastRunId?: mongoose.Types.ObjectId;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const SprintSlotSchema = new Schema<ISprintSlot>(
  {
    sprintId: { type: Schema.Types.ObjectId, ref: "Sprint", required: true },
    at: { type: Date, required: true },
    kind: {
      type: String,
      enum: ["implement", "review", "fix-review", "release", "custom"],
      required: true,
    },
    title: { type: String, required: true, maxlength: 200 },
    task: { type: String, default: "", maxlength: 40_000 },
    config: { type: Schema.Types.Mixed, default: {} },
    dependsOn: { type: [String], default: [] },
    onUpstreamRunning: {
      waitMinutes: { type: Number, required: true, min: 0 },
    },
    status: {
      type: String,
      enum: [
        "scheduled",
        "waiting",
        "queued",
        "running",
        "succeeded",
        "failed",
        "skipped",
        "cancelled",
      ],
      default: "scheduled",
    },
    skipReason: { type: String },
    lastRunId: { type: Schema.Types.ObjectId, ref: "CodingRun" },
    order: { type: Number, required: true },
  },
  { collection: "sprint_slots", timestamps: true, minimize: false },
);

SprintSlotSchema.index({ sprintId: 1, at: 1, order: 1 });
SprintSlotSchema.index({ status: 1, at: 1 });

export const SprintSlotModel =
  existingModel<ISprintSlot>("SprintSlot") ||
  mongoose.model<ISprintSlot>("SprintSlot", SprintSlotSchema);
