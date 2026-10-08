import type { ApnsEnvironment, MobileApp } from "@repo/schemas";
import mongoose from "mongoose";

export interface IMobileDevice extends mongoose.Document {
  /** Minted by the app on first launch; one per install. */
  installationId: string;
  app: MobileApp;
  environment: ApnsEnvironment;
  name?: string;
  pushToken?: string;
  liveActivityStartToken?: string;
  liveActivities: { activityId: string; token: string }[];
  createdAt: Date;
  updatedAt: Date;
}

const mobileDeviceSchema = new mongoose.Schema<IMobileDevice>(
  {
    installationId: { type: String, required: true, unique: true },
    app: { type: String, required: true, enum: ["hours", "voice"] },
    environment: {
      type: String,
      required: true,
      enum: ["development", "production"],
    },
    name: String,
    pushToken: String,
    liveActivityStartToken: String,
    liveActivities: {
      type: [
        {
          _id: false,
          activityId: { type: String, required: true },
          token: { type: String, required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

mobileDeviceSchema.index({ app: 1 });

export const MobileDevice: mongoose.Model<IMobileDevice> =
  mongoose.models.MobileDevice ||
  mongoose.model<IMobileDevice>("MobileDevice", mobileDeviceSchema);
