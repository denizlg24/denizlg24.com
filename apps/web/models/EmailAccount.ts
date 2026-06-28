import mongoose, { type Document, Schema } from "mongoose";
import type { EncryptedSecret } from "@/lib/encrypted-secret";
import type { ILeanEmail } from "@/models/Email";

export type EmailAccountProvider =
  | "custom"
  | "gmail"
  | "outlook"
  | "yahoo"
  | "icloud";

export interface IEmailAccount extends Document {
  provider?: EmailAccountProvider;
  displayName?: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  imapPassword: EncryptedSecret;
  inboxName: string;
  lastUid: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpRequireTls?: boolean;
  smtpUser?: string;
  smtpPassword?: EncryptedSecret;
  smtpPasswordSharedWithImap?: boolean;
  smtpFromName?: string;
  smtpFromAddress?: string;
  lastSmtpTestAt?: Date;
  lastSmtpError?: string;
  emails?: string[];
}

export interface ILeanEmailAccount {
  _id: string | mongoose.Types.ObjectId;
  provider?: EmailAccountProvider;
  displayName?: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  imapPassword: EncryptedSecret;
  inboxName: string;
  lastUid: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpRequireTls?: boolean;
  smtpUser?: string;
  smtpPassword?: EncryptedSecret;
  smtpPasswordSharedWithImap?: boolean;
  smtpFromName?: string;
  smtpFromAddress?: string;
  lastSmtpTestAt?: Date;
  lastSmtpError?: string;
  emails?: string[] | ILeanEmail[];
}

const EncryptedSecretSchema = new Schema<EncryptedSecret>(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  { _id: false },
);

const EmailAccountSchema = new Schema<IEmailAccount>({
  provider: {
    type: String,
    enum: ["custom", "gmail", "outlook", "yahoo", "icloud"],
    default: "custom",
  },
  displayName: { type: String },
  host: { type: String, required: true },
  port: { type: Number, required: true },
  secure: { type: Boolean, required: true },
  user: { type: String, required: true },
  imapPassword: { type: EncryptedSecretSchema, required: true },
  inboxName: { type: String, required: true },
  lastUid: { type: Number, default: 0 },
  smtpHost: { type: String },
  smtpPort: { type: Number },
  smtpSecure: { type: Boolean },
  smtpRequireTls: { type: Boolean },
  smtpUser: { type: String },
  smtpPassword: { type: EncryptedSecretSchema },
  smtpPasswordSharedWithImap: { type: Boolean },
  smtpFromName: { type: String },
  smtpFromAddress: { type: String },
  lastSmtpTestAt: { type: Date },
  lastSmtpError: { type: String },
  emails: [{ type: Schema.Types.ObjectId, ref: "Email" }],
});

export const EmailAccountModel: mongoose.Model<IEmailAccount> =
  mongoose.models.EmailAccount ||
  mongoose.model<IEmailAccount>("EmailAccount", EmailAccountSchema);
