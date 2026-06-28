import mongoose, { type Document, Schema } from "mongoose";

export interface ICalendarExternalEventSync extends Document {
  provider: "google";
  localEventId: mongoose.Types.ObjectId;
  remoteCalendarId: string;
  remoteEventId: string;
  lastSyncedHash?: string;
  lastSyncedAt?: Date;
  pendingAction?: "upsert" | "delete";
  lastError?: string;
  updatedAt: Date;
}

export interface ILeanCalendarExternalEventSync {
  _id: string | mongoose.Types.ObjectId;
  provider: "google";
  localEventId: string | mongoose.Types.ObjectId;
  remoteCalendarId: string;
  remoteEventId: string;
  lastSyncedHash?: string;
  lastSyncedAt?: Date;
  pendingAction?: "upsert" | "delete";
  lastError?: string;
  updatedAt: Date;
}

const CalendarExternalEventSyncSchema = new Schema<ICalendarExternalEventSync>(
  {
    provider: {
      type: String,
      enum: ["google"],
      required: true,
      index: true,
    },
    localEventId: {
      type: Schema.Types.ObjectId,
      ref: "CalendarEvent",
      required: true,
      index: true,
    },
    remoteCalendarId: { type: String, required: true },
    remoteEventId: { type: String, required: true, index: true },
    lastSyncedHash: { type: String },
    lastSyncedAt: { type: Date },
    pendingAction: { type: String, enum: ["upsert", "delete"] },
    lastError: { type: String },
  },
  { timestamps: true },
);

CalendarExternalEventSyncSchema.index(
  { provider: 1, localEventId: 1, remoteCalendarId: 1 },
  { unique: true },
);
CalendarExternalEventSyncSchema.index(
  { provider: 1, remoteCalendarId: 1, remoteEventId: 1 },
  { unique: true },
);

export const CalendarExternalEventSync: mongoose.Model<ICalendarExternalEventSync> =
  (mongoose.models.CalendarExternalEventSync as
    | mongoose.Model<ICalendarExternalEventSync>
    | undefined) ||
  mongoose.model<ICalendarExternalEventSync>(
    "CalendarExternalEventSync",
    CalendarExternalEventSyncSchema,
  );
