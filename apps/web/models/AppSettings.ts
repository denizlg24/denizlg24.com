import mongoose, { type Document, Schema } from "mongoose";

export interface IStoredCv {
  url: string;
  filename: string;
  size: number;
  updatedAt: Date;
}

export interface IAppSettings extends Document<string> {
  _id: "singleton";
  timeZone: string | null;
  cv: IStoredCv | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanAppSettings {
  _id: "singleton";
  timeZone: string | null;
  cv: IStoredCv | null;
  createdAt: Date;
  updatedAt: Date;
}

const AppSettingsSchema = new Schema<IAppSettings>(
  {
    _id: { type: String, default: "singleton" },
    timeZone: { type: String, default: null },
    cv: {
      type: new Schema<IStoredCv>(
        {
          url: { type: String, required: true },
          filename: { type: String, required: true },
          size: { type: Number, required: true },
          updatedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
);

export const AppSettings: mongoose.Model<IAppSettings> =
  (mongoose.models.AppSettings as mongoose.Model<IAppSettings> | undefined) ||
  mongoose.model<IAppSettings>("AppSettings", AppSettingsSchema);
