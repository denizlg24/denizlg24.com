import mongoose, { type Document, Schema } from "mongoose";

export type NoteGroupKind = "manual" | "generated" | "system";
export type NoteGroupSource = "user" | "llm" | "semantic" | "migration";

export interface INoteGroup extends Document {
  name: string;
  description?: string;
  color?: string;
  parentId?: mongoose.Types.ObjectId | null;
  autoCreated: boolean;
  kind?: NoteGroupKind;
  source?: NoteGroupSource;
  lockedByUser?: boolean;
  semanticRunId?: mongoose.Types.ObjectId;
  semanticClusterKey?: string;
  confidence?: number;
  aliases?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanNoteGroup {
  _id: string;
  name: string;
  description?: string;
  color?: string;
  parentId?: string | null;
  autoCreated: boolean;
  kind?: NoteGroupKind;
  source?: NoteGroupSource;
  lockedByUser?: boolean;
  semanticRunId?: string | mongoose.Types.ObjectId;
  semanticClusterKey?: string;
  confidence?: number;
  aliases?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const NOTE_GROUP_MODEL_NAME = "KnowledgeNoteGroup";
const NOTE_GROUP_COLLECTION_NAME = "knowledge_note_groups";

const NoteGroupSchema = new Schema<INoteGroup>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String },
    color: { type: String },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: NOTE_GROUP_MODEL_NAME,
      default: null,
      index: true,
    },
    autoCreated: { type: Boolean, default: false },
    kind: {
      type: String,
      enum: ["manual", "generated", "system"],
      default: "manual",
      index: true,
    },
    source: {
      type: String,
      enum: ["user", "llm", "semantic", "migration"],
      default: "user",
      index: true,
    },
    lockedByUser: { type: Boolean, default: true, index: true },
    semanticRunId: { type: Schema.Types.ObjectId, ref: "KnowledgeSemanticRun" },
    semanticClusterKey: { type: String, index: true },
    confidence: { type: Number, min: 0, max: 1 },
    aliases: [{ type: String, trim: true }],
  },
  { timestamps: true },
);

export const NoteGroup: mongoose.Model<INoteGroup> =
  (mongoose.models[NOTE_GROUP_MODEL_NAME] as
    | mongoose.Model<INoteGroup>
    | undefined) ||
  mongoose.model<INoteGroup>(
    NOTE_GROUP_MODEL_NAME,
    NoteGroupSchema,
    NOTE_GROUP_COLLECTION_NAME,
  );
