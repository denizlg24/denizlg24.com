import type {
  DomainEventType,
  TriggerFiring,
  TriggerResult,
} from "@repo/schemas";
import mongoose from "mongoose";

/** Events expire after a month: they are a trigger log, not a record of anything. */
export const DOMAIN_EVENT_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface IDomainEvent {
  _id: mongoose.Types.ObjectId;
  type: DomainEventType;
  payload: Record<string, string | number | boolean>;
  at: Date;
  /** Triggers whose actions led here, outermost first; empty for an owner's own action. */
  triggerIds: string[];
  depth: number;
  /** Set for events a retry could emit twice (a re-run job, a re-linked row). */
  dedupeKey?: string;
  /** Claimed by the one dispatcher that runs its triggers. */
  dispatchedAt: Date | null;
  firings: TriggerFiring[];
}

const domainEventSchema = new mongoose.Schema<IDomainEvent>(
  {
    type: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    at: { type: Date, required: true },
    triggerIds: { type: [String], default: [] },
    depth: { type: Number, default: 0 },
    dedupeKey: { type: String },
    dispatchedAt: { type: Date, default: null },
    firings: { type: mongoose.Schema.Types.Mixed, default: [] },
  },
  { collection: "domain_events", minimize: false, versionKey: false },
);

domainEventSchema.index(
  { at: 1 },
  { expireAfterSeconds: DOMAIN_EVENT_TTL_SECONDS },
);
domainEventSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
domainEventSchema.index({ "firings.triggerId": 1, at: -1 });

export const DomainEventModel: mongoose.Model<IDomainEvent> =
  mongoose.models.DomainEvent ||
  mongoose.model<IDomainEvent>("DomainEvent", domainEventSchema);

export interface IWorkspaceTrigger {
  _id: mongoose.Types.ObjectId;
  name: string;
  enabled: boolean;
  event: DomainEventType;
  filter: { field: string; op: string; value: string | number | boolean }[];
  schedule: { cron: string; timeZone: string } | null;
  action: Record<string, unknown>;
  maxPerHour: number;
  consecutiveFailures: number;
  disabledReason: string | null;
  lastFiredAt: Date | null;
  lastResult: TriggerResult | null;
  nextRunAt: Date | null;
  /** Fixed one-hour window the rate limit counts in. */
  windowStart: Date | null;
  windowCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const workspaceTriggerSchema = new mongoose.Schema<IWorkspaceTrigger>(
  {
    name: { type: String, required: true, maxlength: 120 },
    enabled: { type: Boolean, default: true },
    event: { type: String, required: true },
    filter: { type: mongoose.Schema.Types.Mixed, default: [] },
    schedule: { type: mongoose.Schema.Types.Mixed, default: null },
    action: { type: mongoose.Schema.Types.Mixed, required: true },
    maxPerHour: { type: Number, default: 10 },
    consecutiveFailures: { type: Number, default: 0 },
    disabledReason: { type: String, default: null },
    lastFiredAt: { type: Date, default: null },
    lastResult: { type: mongoose.Schema.Types.Mixed, default: null },
    nextRunAt: { type: Date, default: null },
    windowStart: { type: Date, default: null },
    windowCount: { type: Number, default: 0 },
  },
  {
    collection: "workspace_triggers",
    minimize: false,
    timestamps: true,
    versionKey: false,
  },
);

workspaceTriggerSchema.index({ event: 1, enabled: 1 });
workspaceTriggerSchema.index({ enabled: 1, nextRunAt: 1 });

export const WorkspaceTriggerModel: mongoose.Model<IWorkspaceTrigger> =
  mongoose.models.WorkspaceTrigger ||
  mongoose.model<IWorkspaceTrigger>("WorkspaceTrigger", workspaceTriggerSchema);

/**
 * Which triggers an agent run a trigger started descends from, so that the
 * events its tool calls cause — separate requests, carrying its actor —
 * still count towards loop protection.
 */
export interface IWorkflowCausation {
  _id: string;
  triggerIds: string[];
  depth: number;
  createdAt: Date;
}

const workflowCausationSchema = new mongoose.Schema<IWorkflowCausation>(
  {
    _id: { type: String, required: true },
    triggerIds: { type: [String], default: [] },
    depth: { type: Number, required: true },
    createdAt: { type: Date, required: true },
  },
  { collection: "workflow_causations", versionKey: false },
);

workflowCausationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 },
);

export const WorkflowCausationModel: mongoose.Model<IWorkflowCausation> =
  mongoose.models.WorkflowCausation ||
  mongoose.model<IWorkflowCausation>(
    "WorkflowCausation",
    workflowCausationSchema,
  );
