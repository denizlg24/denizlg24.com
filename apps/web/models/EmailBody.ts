import mongoose, { type Document, Schema } from "mongoose";

/**
 * The parsed body of one email, kept out of the `Email` document on purpose.
 *
 * `Email` is read in bulk — the triage candidate scan pages through it, the
 * inbox lists it, the dashboard counts it — and Mongo returns whole documents.
 * A megabyte of HTML on each row would be dragged through every one of those
 * queries to satisfy the one screen that actually renders it.
 */
export interface IEmailBody extends Document {
  emailId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  uid: number;
  text: string;
  html: string;
  attachmentCount: number;
  /** True when either field hit BODY_MAX_CHARS and was cut. */
  truncated: boolean;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Bounded so one pathological message cannot approach Mongo's 16 MB document
 * limit and start failing writes. A body past this is unreadable as prose
 * anyway; the untruncated copy is still on the IMAP server.
 */
export const BODY_MAX_CHARS = 2_000_000;

const EmailBodySchema = new Schema<IEmailBody>(
  {
    emailId: {
      type: Schema.Types.ObjectId,
      ref: "Email",
      required: true,
      unique: true,
    },
    accountId: { type: Schema.Types.ObjectId, required: true, index: true },
    uid: { type: Number, required: true },
    // Not `required`: Mongoose treats "" as missing for a required String, and
    // an HTML-only message legitimately has no text (and vice versa). The
    // default carries the "present but empty" case instead.
    text: { type: String, default: "" },
    html: { type: String, default: "" },
    attachmentCount: { type: Number, required: true, default: 0 },
    truncated: { type: Boolean, required: true, default: false },
    fetchedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

export const EmailBodyModel: mongoose.Model<IEmailBody> =
  mongoose.models.EmailBody ||
  mongoose.model<IEmailBody>("EmailBody", EmailBodySchema);
