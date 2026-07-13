import mongoose, { Schema } from "mongoose";

export const AGENT_SOURCE_TYPES = [
  "conversation",
  "tool-result",
  "feedback",
  "note",
  "calendar",
  "person",
  "project",
  "course",
  "email-triage",
  "journal",
  "file",
  "manual",
] as const;

export const AGENT_ACTORS = ["user", "agent", "external", "system"] as const;
export const AGENT_TRUST_LEVELS = [
  "highest",
  "high",
  "medium",
  "low",
  "untrusted",
  "derived",
] as const;
export const AGENT_SENSITIVITIES = [
  "standard",
  "personal",
  "sensitive",
  "restricted",
  "denied",
] as const;
export const AGENT_EXPLICITNESS = [
  "explicit",
  "inferred",
  "hypothesis",
] as const;
export const AGENT_MEMORY_TYPES = [
  "core",
  "semantic",
  "episodic",
  "reflection",
] as const;
export const AGENT_MEMORY_STATUSES = [
  "active",
  "superseded",
  "archived",
  "deleted",
] as const;
export const AGENT_TEMPORAL_PRECISIONS = [
  "exact",
  "day",
  "month",
  "year",
  "range",
  "unknown",
] as const;

export const AgentSourceRefSchema = new Schema(
  {
    entityType: { type: String, required: true, maxlength: 64 },
    entityId: { type: String, required: true, maxlength: 256 },
    revision: { type: String, maxlength: 256 },
  },
  { _id: false },
);

export const AgentEntityRefSchema = new Schema(
  {
    entityType: {
      type: String,
      enum: [
        "person",
        "project",
        "course",
        "note",
        "calendar",
        "conversation",
        "journal",
        "kanban",
        "email",
        "other",
      ],
      required: true,
    },
    entityId: { type: String, required: true, maxlength: 256 },
    label: { type: String, maxlength: 256 },
  },
  { _id: false },
);

export const AgentTemporalSchema = new Schema(
  {
    validFrom: { type: Date },
    validUntil: {
      type: Date,
      validate: {
        validator: function (value?: Date) {
          const temporal = this as unknown as { validFrom?: Date };
          return !value || !temporal.validFrom || value > temporal.validFrom;
        },
        message: "validUntil must be after validFrom",
      },
    },
    precision: {
      type: String,
      enum: AGENT_TEMPORAL_PRECISIONS,
      default: "unknown",
    },
    condition: { type: String, maxlength: 1_000 },
    timezone: { type: String, maxlength: 100 },
  },
  { _id: false },
);

export function existingModel<T>(name: string): mongoose.Model<T> | undefined {
  return mongoose.models[name] as mongoose.Model<T> | undefined;
}
