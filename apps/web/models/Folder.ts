import mongoose from "mongoose";
import type { ILeanNote } from "./Notes";

export interface IFolder extends mongoose.Document {
  name: string;
  parentFolder?: mongoose.Types.ObjectId | IFolder;
  notes: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanFolder {
  _id: string;
  name: string;
  parentFolder?: string;
  notes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanFolderWithNotes {
  _id: string;
  name: string;
  parentFolder?: string;
  notes: ILeanNote[];
  createdAt: Date;
  updatedAt: Date;
}

const FolderSchema = new mongoose.Schema<IFolder>(
  {
    name: { type: String, required: true },
    parentFolder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Folder",
      default: null,
    },
    notes: [{ type: mongoose.Schema.Types.ObjectId, ref: "Note" }],
  },
  { timestamps: true },
);

FolderSchema.index({ name: "text" });

export const Folder: mongoose.Model<IFolder> =
  mongoose.models.Folder || mongoose.model<IFolder>("Folder", FolderSchema);
