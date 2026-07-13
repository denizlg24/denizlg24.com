import mongoose, { type Document, Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

export interface IAgentAuditEvent extends Document {
  auditId: string;
  action: string;
  actor: "user" | "agent" | "policy" | "system";
  targetType: string;
  targetId: string;
  targetRevision?: number;
  reason: string;
  metadata: Record<string, unknown>;
  contentRedacted: boolean;
  occurredAt: Date;
  createdAt: Date;
}

const AgentAuditEventSchema = new Schema<IAgentAuditEvent>(
  {
    auditId: { type: String, required: true, immutable: true },
    action: { type: String, required: true, immutable: true },
    actor: {
      type: String,
      enum: ["user", "agent", "policy", "system"],
      required: true,
      immutable: true,
    },
    targetType: { type: String, required: true, immutable: true },
    targetId: { type: String, required: true, immutable: true },
    targetRevision: { type: Number, immutable: true },
    reason: { type: String, required: true, maxlength: 2_000, immutable: true },
    metadata: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
      immutable: true,
    },
    contentRedacted: { type: Boolean, required: true, default: false },
    occurredAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
  },
  {
    collection: "agent_audit_events",
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
  },
);

AgentAuditEventSchema.index({ auditId: 1 }, { unique: true });
AgentAuditEventSchema.index({ targetType: 1, targetId: 1, occurredAt: -1 });
AgentAuditEventSchema.index({ occurredAt: -1 });

export const AgentAuditEvent =
  existingModel<IAgentAuditEvent>("AgentAuditEvent") ||
  mongoose.model<IAgentAuditEvent>("AgentAuditEvent", AgentAuditEventSchema);
