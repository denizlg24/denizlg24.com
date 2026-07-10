import mongoose, { type Document, Schema } from "mongoose";

export interface IAppSettings extends Document<string> {
  _id: "singleton";
  timeZone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanAppSettings {
  _id: "singleton";
  timeZone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const AppSettingsSchema = new Schema<IAppSettings>(
  {
    _id: { type: String, default: "singleton" },
    timeZone: { type: String, default: null },
  },
  { timestamps: true },
);

export const AppSettings: mongoose.Model<IAppSettings> =
  (mongoose.models.AppSettings as mongoose.Model<IAppSettings> | undefined) ||
  mongoose.model<IAppSettings>("AppSettings", AppSettingsSchema);
