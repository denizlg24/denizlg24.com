import mongoose, { type Document, Schema } from "mongoose";
import type { EncryptedSecret } from "@/lib/encrypted-secret";

export interface ICalendarExternalConnection extends Document {
  provider: "google";
  enabled: boolean;
  calendarId: string;
  accountEmail?: string;
  scope: string[];
  encryptedRefreshToken: EncryptedSecret;
  connectedAt: Date;
  updatedAt: Date;
  lastSyncAt?: Date;
  lastSyncError?: string;
  needsReauth?: boolean;
}

export interface ILeanCalendarExternalConnection {
  _id: string | mongoose.Types.ObjectId;
  provider: "google";
  enabled: boolean;
  calendarId: string;
  accountEmail?: string;
  scope: string[];
  encryptedRefreshToken: EncryptedSecret;
  connectedAt: Date;
  updatedAt: Date;
  lastSyncAt?: Date;
  lastSyncError?: string;
  needsReauth?: boolean;
}

const EncryptedSecretSchema = new Schema<EncryptedSecret>(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  { _id: false },
);

const CalendarExternalConnectionSchema =
  new Schema<ICalendarExternalConnection>(
    {
      provider: {
        type: String,
        enum: ["google"],
        required: true,
        unique: true,
      },
      enabled: { type: Boolean, default: true },
      calendarId: { type: String, default: "primary" },
      accountEmail: { type: String },
      scope: { type: [String], default: [] },
      encryptedRefreshToken: { type: EncryptedSecretSchema, required: true },
      connectedAt: { type: Date, default: () => new Date() },
      lastSyncAt: { type: Date },
      lastSyncError: { type: String },
      needsReauth: { type: Boolean, default: false },
    },
    { timestamps: true },
  );

export const CalendarExternalConnection: mongoose.Model<ICalendarExternalConnection> =
  (mongoose.models.CalendarExternalConnection as
    | mongoose.Model<ICalendarExternalConnection>
    | undefined) ||
  mongoose.model<ICalendarExternalConnection>(
    "CalendarExternalConnection",
    CalendarExternalConnectionSchema,
  );
