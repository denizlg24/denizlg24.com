import type { AgentPersonDraft } from "@repo/schemas";
import mongoose, { Schema } from "mongoose";
import { existingModel } from "./AgentMemoryCommon";

// Not `extends Document`: the wire field `model` would collide with
// mongoose's `Document.model()` method (same shape as IAgentMemoryRun).
export interface IAgentResourceSuggestion {
  _id: mongoose.Types.ObjectId;
  resourceType: "person";
  entityKey: string;
  entityLabel: string;
  draft: AgentPersonDraft;
  memoryIds: mongoose.Types.ObjectId[];
  confidence: number;
  reason: string;
  existingResourceMatches: { resourceId: string; name: string }[];
  status: "pending" | "accepted" | "dismissed";
  model: string;
  decidedAt?: Date;
  resultingResourceId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AgentResourceSuggestionSchema = new Schema<IAgentResourceSuggestion>(
  {
    resourceType: { type: String, enum: ["person"], required: true },
    entityKey: { type: String, required: true, maxlength: 512 },
    entityLabel: { type: String, required: true, maxlength: 256 },
    draft: {
      type: new Schema(
        {
          name: { type: String, required: true, maxlength: 256 },
          relationToOwner: { type: String, required: true, maxlength: 1_000 },
          notes: { type: String, required: true, maxlength: 8_192 },
          placeMet: { type: String, maxlength: 512 },
          email: { type: String, maxlength: 320 },
          phone: { type: String, maxlength: 64 },
          website: { type: String, maxlength: 2_048 },
        },
        { _id: false },
      ),
      required: true,
    },
    memoryIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "AgentMemory" }],
      required: true,
      validate: (v: mongoose.Types.ObjectId[]) =>
        v.length > 0 && v.length <= 100,
    },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    reason: { type: String, required: true, maxlength: 4_096 },
    existingResourceMatches: {
      type: [
        new Schema(
          {
            resourceId: { type: String, required: true },
            name: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "dismissed"],
      default: "pending",
    },
    model: { type: String, required: true, maxlength: 200 },
    decidedAt: { type: Date },
    resultingResourceId: { type: String },
  },
  { collection: "agent_resource_suggestions", timestamps: true },
);

AgentResourceSuggestionSchema.index({ status: 1, createdAt: -1 });
AgentResourceSuggestionSchema.index({ entityKey: 1, status: 1 });
// At most one pending suggestion per entity: the read-before-insert generation
// path can otherwise race two concurrent runs into duplicate pending rows.
AgentResourceSuggestionSchema.index(
  { entityKey: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } },
);

export const AgentResourceSuggestion =
  existingModel<IAgentResourceSuggestion>("AgentResourceSuggestion") ||
  mongoose.model<IAgentResourceSuggestion>(
    "AgentResourceSuggestion",
    AgentResourceSuggestionSchema,
  );
