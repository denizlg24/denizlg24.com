import mongoose, { type Document, Schema } from "mongoose";

export interface IPersonGroup extends Document {
  name: string;
  description?: string;
  color?: string;
  parentId?: mongoose.Types.ObjectId | null;
  autoCreated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanPersonGroup {
  _id: string;
  name: string;
  description?: string;
  color?: string;
  parentId?: string | null;
  autoCreated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PersonGroupSchema = new Schema<IPersonGroup>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String },
    color: { type: String },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: "PersonGroup",
      default: null,
      index: true,
    },
    autoCreated: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const PersonGroup: mongoose.Model<IPersonGroup> =
  (mongoose.models.PersonGroup as mongoose.Model<IPersonGroup> | undefined) ||
  mongoose.model<IPersonGroup>("PersonGroup", PersonGroupSchema);
