import mongoose, { type Document, Schema } from "mongoose";

export type TagContext = "blog" | "project";

export interface ITagGroup extends Document {
  tag: string;
  context: TagContext;
  group: string;
  createdAt: Date;
  updatedAt: Date;
}

const TagGroupSchema = new Schema<ITagGroup>(
  {
    tag: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    context: {
      type: String,
      required: true,
      enum: ["blog", "project"],
    },
    group: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

TagGroupSchema.index({ tag: 1, context: 1 }, { unique: true });

export const TagGroup: mongoose.Model<ITagGroup> =
  mongoose.models.TagGroup ||
  mongoose.model<ITagGroup>("TagGroup", TagGroupSchema);
