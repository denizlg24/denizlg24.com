import mongoose, { type Document, Schema } from "mongoose";
import type { ILeanEmail } from "@/models/Email";

export interface IEmailAccount extends Document {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  imapPassword: {
    ciphertext: string;
    iv: string;
    authTag: string;
  };
  inboxName: string;
  lastUid: number;
  emails?: string[];
}

export interface ILeanEmailAccount {
  _id: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  imapPassword: {
    ciphertext: string;
    iv: string;
    authTag: string;
  };
  inboxName: string;
  lastUid: number;
  emails?: string[] | ILeanEmail[];
}

const EmailAccountSchema = new Schema<IEmailAccount>({
  host: { type: String, required: true },
  port: { type: Number, required: true },
  secure: { type: Boolean, required: true },
  user: { type: String, required: true },
  imapPassword: {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  inboxName: { type: String, required: true },
  lastUid: { type: Number, default: 0 },
  emails: [{ type: Schema.Types.ObjectId, ref: "Email" }],
});

export const EmailAccountModel: mongoose.Model<IEmailAccount> =
  mongoose.models.EmailAccount ||
  mongoose.model<IEmailAccount>("EmailAccount", EmailAccountSchema);
