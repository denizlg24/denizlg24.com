import mongoose, { Schema } from "mongoose";
import type { EncryptedSecret } from "@/lib/encrypted-secret";

/** Personal owner-only credentials. Flow documents share the collection, never the singleton ID. */
export interface IAiConnection {
  _id: string;
  revision: string;
  disconnected?: boolean;
  source?: "stored" | "oauth";
  apiKey?: EncryptedSecret;
  refreshToken?: EncryptedSecret;
  accessExpiresAt?: Date;
  teamIdOrSlug?: string;
  status?: "connected" | "unverified" | "error";
  lastError?: string;
  refreshOwner?: string;
  refreshStartedAt?: Date;
  flow?: EncryptedSecret;
  sessionHash?: string;
  expiresAt?: Date;
}

const secret = new Schema<EncryptedSecret>(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  { _id: false },
);
const schema = new Schema<IAiConnection>(
  {
    _id: { type: String, required: true },
    revision: { type: String, required: true },
    disconnected: Boolean,
    source: { type: String, enum: ["stored", "oauth"] },
    apiKey: { type: secret },
    refreshToken: { type: secret },
    accessExpiresAt: Date,
    teamIdOrSlug: String,
    status: { type: String, enum: ["connected", "unverified", "error"] },
    lastError: String,
    refreshOwner: String,
    refreshStartedAt: Date,
    flow: { type: secret },
    sessionHash: String,
    expiresAt: Date,
  },
  { timestamps: true },
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AiConnection: mongoose.Model<IAiConnection> =
  (mongoose.models.AiConnection as mongoose.Model<IAiConnection> | undefined) ??
  mongoose.model<IAiConnection>("AiConnection", schema);
