import mongoose, { type Document, Schema } from "mongoose";

export interface ISpreadsheet extends Document {
  title: string;
  description?: string;
  tags: string[];
  pinataHash: string;
  pinataFileId?: string;
  pinataUrl: string;
  sizeBytes: number;
  sheetCount: number;
  rowCount: number;
  colCount: number;
  lastOpenedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanSpreadsheet {
  _id: string;
  title: string;
  description?: string;
  tags: string[];
  pinataHash: string;
  pinataFileId?: string;
  pinataUrl: string;
  sizeBytes: number;
  sheetCount: number;
  rowCount: number;
  colCount: number;
  lastOpenedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SpreadsheetSchema = new Schema<ISpreadsheet>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    pinataHash: {
      type: String,
      required: true,
    },
    pinataFileId: {
      type: String,
    },
    pinataUrl: {
      type: String,
      required: true,
    },
    sizeBytes: {
      type: Number,
      default: 0,
    },
    sheetCount: {
      type: Number,
      default: 1,
    },
    rowCount: {
      type: Number,
      default: 0,
    },
    colCount: {
      type: Number,
      default: 0,
    },
    lastOpenedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

SpreadsheetSchema.index({ updatedAt: -1 });
SpreadsheetSchema.index({ tags: 1 });

export const Spreadsheet: mongoose.Model<ISpreadsheet> =
  mongoose.models.Spreadsheet ||
  mongoose.model<ISpreadsheet>("Spreadsheet", SpreadsheetSchema);
