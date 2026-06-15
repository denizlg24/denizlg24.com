import mongoose, { type Document, Schema } from "mongoose";

export interface ITagGroup extends Document {
  tag: string;
  group: string;
  createdAt: Date;
  updatedAt: Date;
}

const TagGroupSchema = new Schema<ITagGroup>(
  {
    tag: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
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

export const TagGroup: mongoose.Model<ITagGroup> =
  mongoose.models.TagGroup ||
  mongoose.model<ITagGroup>("TagGroup", TagGroupSchema);
