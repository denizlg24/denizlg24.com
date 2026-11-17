import mongoose, { Schema } from "mongoose";
import type { SubscriptionProvider } from "@/lib/ai-subscriptions/contract";
import type { EncryptedSecret } from "@/lib/encrypted-secret";

export interface SubscriptionConnection {
  secret: EncryptedSecret;
  model: string;
  label?: string;
  expiresAt?: Date;
  refreshUntil?: Date;
  renewalFailed?: boolean;
  revision: string;
}
export interface AiSubscriptionSettingsRecord {
  _id: string;
  activeProvider: SubscriptionProvider;
  hostId: string;
  chatgpt?: SubscriptionConnection;
  claude?: SubscriptionConnection;
}
const Secret = new Schema<EncryptedSecret>(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  { _id: false },
);
const Connection = new Schema<SubscriptionConnection>(
  {
    secret: { type: Secret, required: true },
    model: { type: String, required: true },
    label: String,
    expiresAt: Date,
    refreshUntil: Date,
    renewalFailed: Boolean,
    revision: { type: String, required: true },
  },
  { _id: false },
);
const Settings = new Schema<AiSubscriptionSettingsRecord>(
  {
    _id: { type: String, default: "singleton" },
    activeProvider: {
      type: String,
      enum: ["gateway", "chatgpt", "claude-code"],
      default: "gateway",
    },
    hostId: { type: String, required: true },
    chatgpt: Connection,
    claude: Connection,
  },
  { timestamps: true },
);
export const AiSubscriptionSettings =
  (mongoose.models
    .AiSubscriptionSettings as mongoose.Model<AiSubscriptionSettingsRecord>) ||
  mongoose.model<AiSubscriptionSettingsRecord>(
    "AiSubscriptionSettings",
    Settings,
  );
