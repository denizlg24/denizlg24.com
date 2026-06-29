import mongoose, { type Document, Schema } from "mongoose";

export interface ICalendarSettings extends Document<string> {
  _id: "singleton";
  holidayCountryCode: string | null;
  generatedBirthdayYears: number[];
  generatedHolidaySyncs: {
    countryCode: string;
    year: number;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanCalendarSettings {
  _id: "singleton";
  holidayCountryCode: string | null;
  generatedBirthdayYears?: number[];
  generatedHolidaySyncs?: {
    countryCode: string;
    year: number;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const GeneratedHolidaySyncSchema = new Schema(
  {
    countryCode: { type: String, required: true },
    year: { type: Number, required: true },
  },
  { _id: false },
);

const CalendarSettingsSchema = new Schema<ICalendarSettings>(
  {
    _id: { type: String, default: "singleton" },
    holidayCountryCode: { type: String, default: null },
    generatedBirthdayYears: { type: [Number], default: [] },
    generatedHolidaySyncs: { type: [GeneratedHolidaySyncSchema], default: [] },
  },
  { timestamps: true },
);

export const CalendarSettings: mongoose.Model<ICalendarSettings> =
  (mongoose.models.CalendarSettings as
    | mongoose.Model<ICalendarSettings>
    | undefined) ||
  mongoose.model<ICalendarSettings>("CalendarSettings", CalendarSettingsSchema);
