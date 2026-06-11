import mongoose, { type Document } from "mongoose";
import { type ILink, LinkSchema } from "./Project";

export interface ITimelineItem extends Document {
  title: string;
  subtitle: string;
  logoUrl?: string;
  dateFrom: string;
  dateTo?: string;
  topics: string[];
  category: "work" | "education" | "personal";
  order: number;
  links?: ILink[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITimelineItemLean {
  _id: string;
  title: string;
  subtitle: string;
  logoUrl?: string;
  dateFrom: string;
  dateTo?: string;
  topics: string[];
  category: "work" | "education" | "personal";
  order: number;
  links?: {
    label: string;
    url: string;
    icon: "external" | "github" | "notepad";
  }[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const timelineItemSchema = new mongoose.Schema<ITimelineItem>(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
    },
    subtitle: {
      type: String,
      required: [true, "Subtitle is required"],
      trim: true,
    },
    logoUrl: {
      type: String,
      trim: true,
    },
    dateFrom: {
      type: String,
      required: [true, "Start date is required"],
      trim: true,
    },
    dateTo: {
      type: String,
      trim: true,
    },
    topics: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => Array.isArray(v),
        message: "Topics must be an array of strings",
      },
    },
    category: {
      type: String,
      enum: ["work", "education", "personal"],
      required: [true, "Category is required"],
    },
    order: {
      type: Number,
      default: 0,
      index: true,
    },
    links: [LinkSchema],
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

timelineItemSchema.index({ category: 1, order: 1 });
timelineItemSchema.index({ category: 1, isActive: 1, order: 1 });

const TimelineItem: mongoose.Model<ITimelineItem> =
  mongoose.models.TimelineItem ||
  mongoose.model<ITimelineItem>("TimelineItem", timelineItemSchema);

export default TimelineItem;
