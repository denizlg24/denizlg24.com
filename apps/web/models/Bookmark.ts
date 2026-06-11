import mongoose, { type Document, Schema } from "mongoose";

export type BookmarkStatus = "open" | "archived";

export interface IBookmark extends Document {
  url: string;
  title: string;
  description?: string;
  favicon?: string;
  image?: string;
  siteName?: string;
  tags: string[];
  groupIds: mongoose.Types.ObjectId[];
  content: string;
  publishedDate?: Date;
  status: BookmarkStatus;
  class?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanBookmark {
  _id: string;
  url: string;
  title: string;
  description?: string;
  favicon?: string;
  image?: string;
  siteName?: string;
  tags: string[];
  groupIds: string[];
  content: string;
  publishedDate?: Date;
  status: BookmarkStatus;
  class?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BookmarkSchema = new Schema<IBookmark>(
  {
    url: { type: String, required: true, trim: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String },
    favicon: { type: String },
    image: { type: String },
    siteName: { type: String },
    tags: [{ type: String, trim: true }],
    groupIds: [
      { type: Schema.Types.ObjectId, ref: "BookmarkGroup", index: true },
    ],
    content: { type: String, default: "" },
    publishedDate: { type: Date },
    status: {
      type: String,
      enum: ["open", "archived"],
      default: "open",
      index: true,
    },
    class: { type: String, trim: true },
  },
  { timestamps: true },
);

BookmarkSchema.index({ createdAt: -1 });
BookmarkSchema.index({ tags: 1 });

export const Bookmark: mongoose.Model<IBookmark> =
  mongoose.models.Bookmark ||
  mongoose.model<IBookmark>("Bookmark", BookmarkSchema);
