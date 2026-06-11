import mongoose from "mongoose";

export interface ICalendarEvent {
  _id: unknown;
  date: Date;
  calendarDate: string;
  isAllDay: boolean;
  kind: "manual" | "holiday" | "birthday";
  source?: {
    provider: "nager-date" | "people";
    providerKey: string;
    countryCode?: string;
    personId?: mongoose.Types.ObjectId | string;
    generatedYear?: number;
    isCustomized: boolean;
    isSuppressed: boolean;
    metadata?: Record<string, unknown>;
  };
  title: string;
  place?: string;
  links: {
    _id: unknown;
    label: string;
    icon?: string;
    url: string;
  }[];
  status: "scheduled" | "completed" | "canceled";
  notifyBySlack: boolean;
  isNotificationSent: boolean;
  notifyBeforeMinutes: number;
  notifyAt?: Date;
}

export interface ILeanCalendarEvent {
  _id: string;
  date: Date;
  calendarDate: string;
  isAllDay: boolean;
  kind: "manual" | "holiday" | "birthday";
  source?: {
    provider: "nager-date" | "people";
    providerKey: string;
    countryCode?: string;
    personId?: string;
    generatedYear?: number;
    isCustomized: boolean;
    isSuppressed: boolean;
    metadata?: Record<string, unknown>;
  };
  title: string;
  place?: string;
  links: {
    _id: string;
    label: string;
    icon?: string;
    url: string;
  }[];
  status: "scheduled" | "completed" | "canceled";
  notifyBySlack: boolean;
  isNotificationSent: boolean;
  notifyBeforeMinutes: number;
  notifyAt?: Date;
}

const LinkSchema = new mongoose.Schema({
  label: { type: String, required: true },
  icon: { type: String },
  url: { type: String, required: true },
});

const CalendarEventSourceSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["nager-date", "people"],
      required: true,
    },
    providerKey: { type: String, required: true },
    countryCode: { type: String },
    personId: { type: mongoose.Schema.Types.ObjectId, ref: "Person" },
    generatedYear: { type: Number },
    isCustomized: { type: Boolean, default: false },
    isSuppressed: { type: Boolean, default: false, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
);

export const CalendarEventSchema = new mongoose.Schema<ICalendarEvent>({
  date: { type: Date, required: true },
  calendarDate: { type: String, required: true, index: true },
  isAllDay: { type: Boolean, default: false },
  kind: {
    type: String,
    enum: ["manual", "holiday", "birthday"],
    default: "manual",
    index: true,
  },
  source: CalendarEventSourceSchema,
  title: { type: String, required: true },
  place: { type: String },
  links: [LinkSchema],
  status: {
    type: String,
    enum: ["scheduled", "completed", "canceled"],
    default: "scheduled",
    index: true,
  },
  notifyBySlack: { type: Boolean, default: false },
  isNotificationSent: { type: Boolean, default: false, index: true },
  notifyBeforeMinutes: { type: Number, default: 15 },
  notifyAt: {
    type: Date,
    index: true,
  },
});

CalendarEventSchema.index(
  { "source.provider": 1, "source.providerKey": 1 },
  {
    unique: true,
    partialFilterExpression: { "source.providerKey": { $type: "string" } },
  },
);

export const CalendarEvent: mongoose.Model<ICalendarEvent> =
  mongoose.models.CalendarEvent ||
  mongoose.model<ICalendarEvent>("CalendarEvent", CalendarEventSchema);
