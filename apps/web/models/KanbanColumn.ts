import mongoose, { type Document } from "mongoose";

export interface IKanbanColumn extends Document {
  boardId: mongoose.Types.ObjectId;
  title: string;
  color?: string;
  icon?: string;
  order: number;
  wipLimit?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanKanbanColumn {
  _id: string;
  boardId: string;
  title: string;
  color?: string;
  icon?: string;
  order: number;
  wipLimit?: number;
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
    color: { type: String },
    icon: { type: String },
    order: { type: Number, required: true, default: 0 },
    wipLimit: { type: Number },
  },
  { timestamps: true },
);

KanbanColumnSchema.index({ boardId: 1, order: 1 });

export const KanbanColumn: mongoose.Model<IKanbanColumn> =
  mongoose.models.KanbanColumn ||
  mongoose.model<IKanbanColumn>("KanbanColumn", KanbanColumnSchema);
