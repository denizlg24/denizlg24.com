import mongoose from "mongoose";
import {
  TIMETABLE_COLORS,
  type TimetableColor,
} from "@/lib/timetable-constants";

export { TIMETABLE_COLORS, type TimetableColor };
export type { ILeanTimetableEntry } from "@/lib/timetable-constants";

export interface ITimetableEntry {
  _id: unknown;
  title: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  place?: string;
  links: {
    _id: unknown;
    label: string;
    url: string;
    icon?: string;
  }[];
  color: TimetableColor;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TimetableLinkSchema = new mongoose.Schema({
  label: { type: String, required: true },
  url: { type: String, required: true },
  icon: { type: String },
});

const TimetableEntrySchema = new mongoose.Schema<ITimetableEntry>(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
    },
    dayOfWeek: {
      type: Number,
      required: [true, "Day of week is required"],
      min: 0,
      max: 6,
      index: true,
    },
    startTime: {
      type: String,
      required: [true, "Start time is required"],
      trim: true,
    },
    endTime: {
      type: String,
      required: [true, "End time is required"],
      trim: true,
    },
    place: {
      type: String,
      trim: true,
    },
    links: [TimetableLinkSchema],
    color: {
      type: String,
      enum: TIMETABLE_COLORS,
      default: "accent",
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

TimetableEntrySchema.index({ dayOfWeek: 1, startTime: 1 });

export const TimetableEntry: mongoose.Model<ITimetableEntry> =
  mongoose.models.TimetableEntry ||
  mongoose.model<ITimetableEntry>("TimetableEntry", TimetableEntrySchema);
