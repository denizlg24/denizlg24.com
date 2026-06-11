import mongoose, { type Document, Schema } from "mongoose";

export type SemanticSuggestionType =
  | "join-group"
  | "create-group"
  | "rename-group"
  | "move-group"
  | "add-tags"
  | "add-edge"
  | "archive-edge"
  | "cluster-label";

export type SemanticSuggestionStatus =
  | "pending"
  | "accepted"
  | "dismissed"
  | "superseded";

export interface IKnowledgeSemanticSuggestion extends Document {
  runId: mongoose.Types.ObjectId;
  type: SemanticSuggestionType;
  status: SemanticSuggestionStatus;
  noteId?: mongoose.Types.ObjectId;
  groupId?: mongoose.Types.ObjectId;
  targetGroupId?: mongoose.Types.ObjectId;
  proposedParentId?: mongoose.Types.ObjectId | null;
  proposedName?: string;
  proposedDescription?: string;
  proposedTags?: string[];
  proposedRelatedNoteIds?: mongoose.Types.ObjectId[];
  confidence: number;
  reason: string;
  source: "semantic" | "llm-label";
  decidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanKnowledgeSemanticSuggestion {
  _id: string;
  runId: string;
  type: SemanticSuggestionType;
  status: SemanticSuggestionStatus;
  noteId?: string;
  groupId?: string;
  targetGroupId?: string;
  proposedParentId?: string | null;
  proposedName?: string;
  proposedDescription?: string;
  proposedTags?: string[];
  proposedRelatedNoteIds?: string[];
  confidence: number;
  reason: string;
  source: "semantic" | "llm-label";
  decidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MODEL_NAME = "KnowledgeSemanticSuggestion";
const COLLECTION_NAME = "knowledge_semantic_suggestions";

const KnowledgeSemanticSuggestionSchema =
  new Schema<IKnowledgeSemanticSuggestion>(
    {
      runId: {
        type: Schema.Types.ObjectId,
        ref: "KnowledgeSemanticRun",
        required: true,
        index: true,
      },
      type: {
        type: String,
        enum: [
          "join-group",
          "create-group",
          "rename-group",
          "move-group",
          "add-tags",
          "add-edge",
          "archive-edge",
          "cluster-label",
        ],
        required: true,
        index: true,
      },
      status: {
        type: String,
        enum: ["pending", "accepted", "dismissed", "superseded"],
        default: "pending",
        index: true,
      },
      noteId: {
        type: Schema.Types.ObjectId,
        ref: "KnowledgeNote",
        index: true,
      },
      groupId: {
        type: Schema.Types.ObjectId,
        ref: "KnowledgeNoteGroup",
        index: true,
      },
      targetGroupId: {
        type: Schema.Types.ObjectId,
        ref: "KnowledgeNoteGroup",
        index: true,
      },
      proposedParentId: {
        type: Schema.Types.ObjectId,
        ref: "KnowledgeNoteGroup",
        default: undefined,
      },
      proposedName: { type: String },
      proposedDescription: { type: String },
      proposedTags: [{ type: String, trim: true }],
      proposedRelatedNoteIds: [
        { type: Schema.Types.ObjectId, ref: "KnowledgeNote" },
      ],
      confidence: { type: Number, min: 0, max: 1, required: true },
      reason: { type: String, required: true },
      source: {
        type: String,
        enum: ["semantic", "llm-label"],
        default: "semantic",
      },
      decidedAt: { type: Date },
    },
    { timestamps: true },
  );

KnowledgeSemanticSuggestionSchema.index({ status: 1, type: 1 });
KnowledgeSemanticSuggestionSchema.index({ noteId: 1, status: 1 });
KnowledgeSemanticSuggestionSchema.index({ groupId: 1, status: 1 });

export const KnowledgeSemanticSuggestion: mongoose.Model<IKnowledgeSemanticSuggestion> =
  (mongoose.models[MODEL_NAME] as
    | mongoose.Model<IKnowledgeSemanticSuggestion>
    | undefined) ||
  mongoose.model<IKnowledgeSemanticSuggestion>(
    MODEL_NAME,
    KnowledgeSemanticSuggestionSchema,
    COLLECTION_NAME,
  );
