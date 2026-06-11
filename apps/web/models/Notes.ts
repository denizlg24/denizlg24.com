import mongoose from "mongoose";

export interface INote extends mongoose.Document {
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanNote {
  _id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const NoteSchema = new mongoose.Schema<INote>(
  {
    title: { type: String, required: true },
    content: { type: String, required: true, default: "" },
  },
  { timestamps: true },
);

NoteSchema.index({ title: "text", content: "text" });

export const Note: mongoose.Model<INote> =
  mongoose.models.Note || mongoose.model<INote>("Note", NoteSchema);
