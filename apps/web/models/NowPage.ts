import mongoose, { type Document } from "mongoose";

export interface INowPage extends Document {
  content: string;
  updatedAt: Date;
  createdAt: Date;
}

export interface INowPageLean {
  _id: string;
  content: string;
  updatedAt: Date;
  createdAt: Date;
}

const nowPageSchema = new mongoose.Schema<INowPage>(
  {
    content: {
      type: String,
      required: [true, "Content is required"],
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

const NowPage: mongoose.Model<INowPage> =
  mongoose.models.NowPage || mongoose.model<INowPage>("NowPage", nowPageSchema);

export default NowPage;
