import mongoose from "mongoose";

export interface IRateLimit extends mongoose.Document {
  key: string;
  timestamps: Date[];
  createdAt: Date;
  updatedAt: Date;
}

const RateLimitSchema = new mongoose.Schema<IRateLimit>(
  {
    key: { type: String, required: true, unique: true },
    timestamps: { type: [Date], default: [] },
  },
  { timestamps: true },
);

RateLimitSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 120 });

export const RateLimit: mongoose.Model<IRateLimit> =
  mongoose.models.RateLimit ||
  mongoose.model<IRateLimit>("RateLimit", RateLimitSchema);
