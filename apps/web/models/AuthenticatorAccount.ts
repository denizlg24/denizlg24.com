import mongoose, { type Document, Schema } from "mongoose";

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface IAuthenticatorAccount extends Document {
  label: string;
  issuer: string;
  accountName: string;
  secret: {
    ciphertext: string;
    iv: string;
    authTag: string;
  };
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  createdAt: Date;
  updatedAt: Date;
}

const AuthenticatorAccountSchema = new Schema<IAuthenticatorAccount>(
  {
    label: { type: String, required: true },
    issuer: { type: String, default: "" },
    accountName: { type: String, default: "" },
    secret: {
      ciphertext: { type: String, required: true },
      iv: { type: String, required: true },
      authTag: { type: String, required: true },
    },
    algorithm: {
      type: String,
      enum: ["SHA1", "SHA256", "SHA512"],
      default: "SHA1",
    },
    digits: { type: Number, default: 6 },
    period: { type: Number, default: 30 },
  },
  { timestamps: true },
);

AuthenticatorAccountSchema.index({ issuer: 1, accountName: 1 });

export const AuthenticatorAccount: mongoose.Model<IAuthenticatorAccount> =
  mongoose.models.AuthenticatorAccount ||
  mongoose.model<IAuthenticatorAccount>(
    "AuthenticatorAccount",
    AuthenticatorAccountSchema,
  );
