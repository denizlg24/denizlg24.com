import mongoose, { type Document, Schema } from "mongoose";

export interface IEmail extends Document {
  accountId: mongoose.Types.ObjectId;
  messageId: string;
  subject: string;
  from: { name: string | undefined; address: string }[];
  date: Date;
  seen: boolean;
  uid: number;
  inReplyTo?: string;
  references?: string[];
  threadId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanEmail {
  _id: string | mongoose.Types.ObjectId;
  accountId: string | mongoose.Types.ObjectId;
  messageId: string;
  subject: string;
  from: { name: string | undefined; address: string }[];
  date: Date;
  seen: boolean;
  uid: number;
  inReplyTo?: string;
  references?: string[];
  threadId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmailSchema = new Schema<IEmail>(
  {
    accountId: { type: Schema.Types.ObjectId, required: true },
    messageId: { type: String, required: true },
    subject: { type: String, required: true },
    from: { type: [{ name: String, address: String }], required: true },
    date: { type: Date, required: true },
    seen: { type: Boolean, required: true },
    uid: { type: Number, required: true },
    inReplyTo: { type: String },
    references: { type: [String], default: undefined },
    threadId: { type: String, index: true },
  },
  { timestamps: true },
);

EmailSchema.index({ accountId: 1, messageId: 1 }, { unique: true });
EmailSchema.index({ accountId: 1, date: -1 });
EmailSchema.index({ seen: 1 });
EmailSchema.index({ createdAt: -1 });

export const EmailModel: mongoose.Model<IEmail> =
  mongoose.models.Email || mongoose.model<IEmail>("Email", EmailSchema);
