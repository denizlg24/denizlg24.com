import mongoose, { type Document } from "mongoose";

export interface IKanbanBoard extends Document {
  title: string;
  description?: string;
  color?: string;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanKanbanBoard {
  _id: string;
  title: string;
  description?: string;
  color?: string;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const KanbanBoardSchema = new mongoose.Schema<IKanbanBoard>(
  {
    title: { type: String, required: true },
    description: { type: String },
    color: { type: String },
    isArchived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

export const KanbanBoard: mongoose.Model<IKanbanBoard> =
  mongoose.models.KanbanBoard ||
  mongoose.model<IKanbanBoard>("KanbanBoard", KanbanBoardSchema);
