import mongoose, { type Document } from "mongoose";

export type KanbanPriority = "none" | "low" | "medium" | "high" | "urgent";

export interface IKanbanCard extends Document {
  boardId: mongoose.Types.ObjectId;
  columnId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  order: number;
  labels: string[];
  priority: KanbanPriority;
  startDate?: Date;
  dueDate?: Date;
  hasDueTime: boolean;
  calendarEventIds: string[];
  noteIds: string[];
  personIds: string[];
  courseIds: string[];
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanKanbanCard {
  _id: string;
  boardId: string;
  columnId: string;
  title: string;
  description?: string;
  order: number;
  labels: string[];
  priority: KanbanPriority;
  startDate?: Date;
  dueDate?: Date;
  hasDueTime: boolean;
  calendarEventIds: string[];
  noteIds: string[];
  personIds: string[];
  courseIds: string[];
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const KanbanCardSchema = new mongoose.Schema<IKanbanCard>(
  {
    boardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KanbanBoard",
      required: true,
      index: true,
    },
    columnId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KanbanColumn",
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    description: { type: String },
    order: { type: Number, required: true, default: 0 },
    labels: [{ type: String }],
    priority: {
      type: String,
      enum: ["none", "low", "medium", "high", "urgent"],
      default: "none",
    },
    startDate: { type: Date },
    dueDate: { type: Date },
    hasDueTime: { type: Boolean, default: false },
    calendarEventIds: { type: [String], default: [] },
    noteIds: { type: [String], default: [] },
    personIds: { type: [String], default: [] },
    courseIds: { type: [String], default: [] },
    isArchived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

KanbanCardSchema.index({ boardId: 1, columnId: 1, order: 1 });

export const KanbanCard: mongoose.Model<IKanbanCard> =
  mongoose.models.KanbanCard ||
  mongoose.model<IKanbanCard>("KanbanCard", KanbanCardSchema);
