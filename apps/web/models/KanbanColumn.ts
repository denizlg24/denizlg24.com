import mongoose, { type Document } from "mongoose";

export interface IKanbanColumn extends Document {
  boardId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  color?: string;
  icon?: string;
  order: number;
  wipLimit?: number;
  isDoneColumn: boolean;
  isCollapsed: boolean;
  sortRule: "manual" | "priority" | "dueDate";
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanKanbanColumn {
  _id: string;
  boardId: string;
  title: string;
  description?: string;
  color?: string;
  icon?: string;
  order: number;
  wipLimit?: number;
  isDoneColumn: boolean;
  isCollapsed: boolean;
  sortRule: "manual" | "priority" | "dueDate";
  createdAt: Date;
  updatedAt: Date;
}

const KanbanColumnSchema = new mongoose.Schema<IKanbanColumn>(
  {
    boardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KanbanBoard",
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    description: { type: String },
    color: { type: String },
    icon: { type: String },
    order: { type: Number, required: true, default: 0 },
    wipLimit: { type: Number },
    isDoneColumn: { type: Boolean, default: false },
    isCollapsed: { type: Boolean, default: false },
    sortRule: {
      type: String,
      enum: ["manual", "priority", "dueDate"],
      default: "manual",
    },
  },
  { timestamps: true },
);

KanbanColumnSchema.index({ boardId: 1, order: 1 });

export const KanbanColumn: mongoose.Model<IKanbanColumn> =
  mongoose.models.KanbanColumn ||
  mongoose.model<IKanbanColumn>("KanbanColumn", KanbanColumnSchema);
