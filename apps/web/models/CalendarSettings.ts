import mongoose, { type Document, Schema } from "mongoose";

export interface ICalendarSettings extends Document<string> {
  _id: "singleton";
  holidayCountryCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanCalendarSettings {
  _id: "singleton";
  holidayCountryCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CalendarSettingsSchema = new Schema<ICalendarSettings>(
  {
    _id: { type: String, default: "singleton" },
    holidayCountryCode: { type: String, default: null },
  },
  { timestamps: true },
);

export const CalendarSettings: mongoose.Model<ICalendarSettings> =
  (mongoose.models.CalendarSettings as
    | mongoose.Model<ICalendarSettings>
    | undefined) ||
  mongoose.model<ICalendarSettings>("CalendarSettings", CalendarSettingsSchema);
