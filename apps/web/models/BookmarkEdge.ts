import mongoose, { type Document, Schema } from "mongoose";

export interface IBookmarkEdge extends Document {
  from: mongoose.Types.ObjectId;
  to: mongoose.Types.ObjectId;
  strength: number;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanBookmarkEdge {
  _id: string;
  from: string;
  to: string;
  strength: number;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BookmarkEdgeSchema = new Schema<IBookmarkEdge>(
  {
    from: {
      type: Schema.Types.ObjectId,
      ref: "Bookmark",
      required: true,
      index: true,
    },
    to: {
      type: Schema.Types.ObjectId,
      ref: "Bookmark",
      required: true,
      index: true,
    },
    strength: { type: Number, default: 1, min: 0, max: 1 },
    reason: { type: String },
  },
  { timestamps: true },
);

BookmarkEdgeSchema.index({ from: 1, to: 1 }, { unique: true });

export const BookmarkEdge: mongoose.Model<IBookmarkEdge> =
  mongoose.models.BookmarkEdge ||
  mongoose.model<IBookmarkEdge>("BookmarkEdge", BookmarkEdgeSchema);
