import type {
  CodingRunCi,
  CodingRunFailure,
  CodingRunStatus,
  CodingRunUsage,
  RunConfig,
  SprintSlotKind,
} from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface ICodingRun extends Document {
  sprintId: mongoose.Types.ObjectId;
  slotId: mongoose.Types.ObjectId;
  kind: SprintSlotKind;
  /** Resolved at claim; editing the sprint later never rewrites it. */
  config: RunConfig;
  repo: string;
  branch: string;
  baseSha?: string;
  headSha?: string;
  status: CodingRunStatus;
  failure?: CodingRunFailure;
  /** Pushed forward by the runner's heartbeat; a lapsed lease is a lost run. */
  leaseExpiresAt?: Date;
  cancelRequested: boolean;
  runnerId?: string;
  startedAt?: Date;
  completedAt?: Date;
  /** `AgentUIMessage[]`, bounded by `CODING_RUN_MAX_PARTS`. */
  messages: unknown[];
  /** The last events batch applied; a batch at or below it is a retry. */
  lastSeq: number;
  /** `RunResult`, validated by the runner before it is sent. */
  result?: unknown;
  usage?: CodingRunUsage;
  ci?: Omit<CodingRunCi, "checkedAt"> & { checkedAt: Date };
  prUrl?: string;
  workspacePath?: string;
  runnerVersion?: string;
  harnessVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CodingRunSchema = new Schema<ICodingRun>(
  {
    sprintId: { type: Schema.Types.ObjectId, ref: "Sprint", required: true },
    slotId: { type: Schema.Types.ObjectId, ref: "SprintSlot", required: true },
    kind: {
      type: String,
      enum: ["implement", "review", "fix-review", "release", "custom"],
      required: true,
    },
    config: { type: Schema.Types.Mixed, required: true },
    repo: { type: String, required: true },
    branch: { type: String, required: true },
    baseSha: { type: String },
    headSha: { type: String },
    status: {
      type: String,
      enum: ["queued", "running", "succeeded", "failed", "cancelled"],
      default: "queued",
    },
    failure: {
      type: new Schema(
        {
          code: { type: String, required: true },
          message: { type: String, default: "", maxlength: 8_000 },
        },
        { _id: false },
      ),
      default: undefined,
    },
    leaseExpiresAt: { type: Date },
    cancelRequested: { type: Boolean, default: false },
    runnerId: { type: String },
    startedAt: { type: Date },
    completedAt: { type: Date },
    messages: { type: [Schema.Types.Mixed], default: [] },
    lastSeq: { type: Number, default: -1 },
    result: { type: Schema.Types.Mixed },
    usage: { type: Schema.Types.Mixed },
    ci: { type: Schema.Types.Mixed },
    prUrl: { type: String },
    workspacePath: { type: String },
    runnerVersion: { type: String },
    harnessVersion: { type: String },
  },
  { collection: "coding_runs", timestamps: true, minimize: false },
);

CodingRunSchema.index({ status: 1, leaseExpiresAt: 1 });
CodingRunSchema.index({ sprintId: 1, createdAt: -1 });
CodingRunSchema.index({ slotId: 1, createdAt: -1 });

export const CodingRunModel =
  existingModel<ICodingRun>("CodingRun") ||
  mongoose.model<ICodingRun>("CodingRun", CodingRunSchema);
