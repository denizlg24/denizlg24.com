import mongoose, { type Document, Schema } from "mongoose";

export interface IEmailDraft extends Document {
  accountId: mongoose.Types.ObjectId;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html?: string;
  replyToMessageId?: string;
  previousDraftId?: mongoose.Types.ObjectId;
  status: "draft" | "sending" | "sent";
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanEmailDraft {
  _id: string | mongoose.Types.ObjectId;
  accountId: string | mongoose.Types.ObjectId;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html?: string;
  replyToMessageId?: string;
  previousDraftId?: string | mongoose.Types.ObjectId;
  status: "draft" | "sending" | "sent";
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EmailDraftSchema = new Schema<IEmailDraft>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "EmailAccount",
      required: true,
      index: true,
    },
    to: { type: [String], required: true },
    cc: { type: [String], default: [] },
    bcc: { type: [String], default: [] },
    subject: { type: String, default: "" },
    text: { type: String, required: true },
    html: { type: String },
    replyToMessageId: { type: String },
    previousDraftId: { type: Schema.Types.ObjectId, ref: "EmailDraft" },
    status: {
      type: String,
      enum: ["draft", "sending", "sent"],
      default: "draft",
      index: true,
    },
    sentAt: { type: Date },
  },
  { timestamps: true },
);

export const EmailDraftModel: mongoose.Model<IEmailDraft> =
  mongoose.models.EmailDraft ||
  mongoose.model<IEmailDraft>("EmailDraft", EmailDraftSchema);
