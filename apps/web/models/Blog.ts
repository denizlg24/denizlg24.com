import mongoose, { type Document, Schema } from "mongoose";

export interface IBlogReference {
  label: string;
  url: string;
}

export interface IBlog extends Document {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  timeToRead: number;
  media?: string[];
  tags?: string[];
  topicGroups?: string[];
  references?: IBlogReference[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanBlog {
  _id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  timeToRead: number;
  media?: string[];
  tags?: string[];
  topicGroups?: string[];
  references?: IBlogReference[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BlogSchema = new Schema<IBlog>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    excerpt: {
      type: String,
      required: true,
    },
    timeToRead: {
      type: Number,
      required: true,
    },
    media: [
      {
        type: String,
        trim: true,
      },
    ],
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    topicGroups: {
      type: [String],
      default: [],
    },
    references: {
      type: [
        new Schema<IBlogReference>(
          {
            label: { type: String, required: true, trim: true },
            url: { type: String, required: true, trim: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

BlogSchema.index({ isActive: 1 });
BlogSchema.index({ createdAt: -1 });

export const Blog: mongoose.Model<IBlog> =
  mongoose.models.Blog || mongoose.model<IBlog>("Blog", BlogSchema);
