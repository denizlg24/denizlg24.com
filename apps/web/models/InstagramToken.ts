import mongoose from "mongoose";

export interface IInstagramToken extends mongoose.Document {
  accessToken: string;
  expiresAt: Date;
}

const instagramTokenSchema = new mongoose.Schema<IInstagramToken>(
  {
    accessToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: true,
  },
);

const InstagramToken =
  mongoose.models.InstagramToken ||
  mongoose.model<IInstagramToken>("InstagramToken", instagramTokenSchema);

export default InstagramToken;
