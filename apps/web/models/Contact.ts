import mongoose, { type Document, Schema } from "mongoose";

export interface IContact extends Document {
  ticketId: string;
  name: string;
  email: string;
  message: string;
  ipAddress: string;
  userAgent: string;
  status: "pending" | "read" | "responded" | "archived";
  emailSent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanContact {
  _id: string;
  ticketId: string;
  name: string;
  email: string;
  message: string;
  ipAddress: string;
  userAgent: string;
  status: "pending" | "read" | "responded" | "archived";
  emailSent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new Schema<IContact>(
  {
    ticketId: {
      type: String,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    message: {
      type: String,
      required: true,
    },
    ipAddress: {
      type: String,
      required: true,
    },
    userAgent: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "read", "responded", "archived"],
      default: "pending",
    },
    emailSent: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

ContactSchema.pre("save", async function () {
  if (!this.ticketId) {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
    const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
    this.ticketId = `CT-${dateStr}-${randomStr}`;
  }
});

ContactSchema.index({ email: 1, status: 1 });
ContactSchema.index({ status: 1 });
ContactSchema.index({ createdAt: -1 });

export const Contact =
  mongoose.models.Contact || mongoose.model<IContact>("Contact", ContactSchema);
