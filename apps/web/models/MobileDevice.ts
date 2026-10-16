import type {
  ApnsEnvironment,
  DashboardNotificationPrefs,
  MobileApp,
} from "@repo/schemas";
import mongoose, { Schema } from "mongoose";

export interface IMobileDevice extends mongoose.Document {
  /** Minted by the app on first launch; one per install. */
  installationId: string;
  app: MobileApp;
  environment: ApnsEnvironment;
  name?: string;
  pushToken?: string;
  liveActivityStartToken?: string;
  liveActivities: { activityId: string; token: string }[];
  /** Dashboard only: per-kind toggles; a missing kind means its default. */
  notifications?: DashboardNotificationPrefs;
  createdAt: Date;
  updatedAt: Date;
}

const mobileDeviceSchema = new mongoose.Schema<IMobileDevice>(
  {
    installationId: { type: String, required: true, unique: true },
    app: {
      type: String,
      required: true,
      enum: ["hours", "voice", "location", "dashboard"],
    },
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
    notifications: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

mobileDeviceSchema.index({ app: 1 });

export const MobileDevice: mongoose.Model<IMobileDevice> =
  mongoose.models.MobileDevice ||
  mongoose.model<IMobileDevice>("MobileDevice", mobileDeviceSchema);
