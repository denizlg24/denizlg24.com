import mongoose, { type Document, Schema } from "mongoose";

export interface IBlogView extends Document {
  blogId: string;
  views: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanBlogView {
  _id: string;
  blogId: string;
  views: number;
  createdAt: Date;
  updatedAt: Date;
}

const BlogViewSchema = new Schema<IBlogView>(
  {
    blogId: {
      type: String,
      required: true,
      trim: true,
    },
    views: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

export const BlogView: mongoose.Model<IBlogView> =
  mongoose.models.BlogView ||
  mongoose.model<IBlogView>("BlogView", BlogViewSchema);
