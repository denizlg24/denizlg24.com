import type {
  ConnectorApproval,
  ConnectorAuth,
  ConnectorStatus,
} from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";
import type { EncryptedSecret } from "@/lib/encrypted-secret";
import { existingModel } from "./AgentMemoryCommon";

/**
 * OAuth state for an `oauth` connector. Everything a leaked row could be
 * replayed with — tokens, the registered client, the PKCE verifier — is
 * sealed; the pending `state` is kept only as a hash so the callback can find
 * the row without the value itself being stored.
 */
export interface IConnectorOAuth {
  clientInformation?: EncryptedSecret;
  tokens?: EncryptedSecret;
  codeVerifier?: EncryptedSecret;
  stateHash?: string;
  stateExpiresAt?: Date;
  authorizationServer?: {
    issuer?: string;
    authorizationServerUrl: string;
    tokenEndpoint: string;
  };
}

/**
 * The last `tools/list` answer, kept so a turn does not pay a round trip per
 * connector before the model call. `definitions` is the raw MCP payload.
 */
export interface IConnectorToolCache {
  definitions: unknown[];
  instructions?: string;
  fetchedAt: Date;
}

export interface IConnector extends Document {
  slug: string;
  name: string;
  url: string;
  auth: ConnectorAuth;
  approval: ConnectorApproval;
  enabled: boolean;
  disabledTools: string[];
  builtIn: boolean;
  secret?: EncryptedSecret;
  oauth?: IConnectorOAuth;
  toolCache?: IConnectorToolCache;
  status: ConnectorStatus;
  statusDetail?: string;
  lastCheckedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EncryptedSecretSchema = new Schema<EncryptedSecret>(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  { _id: false },
);

const ConnectorSchema = new Schema<IConnector>(
  {
    slug: { type: String, required: true, unique: true, maxlength: 32 },
    name: { type: String, required: true, maxlength: 60 },
    url: { type: String, required: true, maxlength: 2_000 },
    auth: {
      type: String,
      enum: ["service", "none", "bearer", "oauth"],
      required: true,
    },
    approval: {
      type: String,
      enum: ["reads-auto", "always-ask", "never-ask"],
      default: "reads-auto",
      required: true,
    },
    enabled: { type: Boolean, default: true, required: true },
    disabledTools: { type: [String], default: [] },
    builtIn: { type: Boolean, default: false, required: true },
    secret: { type: EncryptedSecretSchema, default: undefined },
    oauth: {
      type: new Schema<IConnectorOAuth>(
        {
          clientInformation: { type: EncryptedSecretSchema },
          tokens: { type: EncryptedSecretSchema },
          codeVerifier: { type: EncryptedSecretSchema },
          stateHash: { type: String },
          stateExpiresAt: { type: Date },
          authorizationServer: {
            type: new Schema(
              {
                issuer: { type: String },
                authorizationServerUrl: { type: String, required: true },
                tokenEndpoint: { type: String, required: true },
              },
              { _id: false },
            ),
          },
        },
        { _id: false },
      ),
      default: undefined,
    },
    toolCache: {
      type: new Schema<IConnectorToolCache>(
        {
          definitions: { type: [Schema.Types.Mixed], default: [] },
          instructions: { type: String, maxlength: 32_000 },
          fetchedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    status: {
      type: String,
      enum: ["ready", "needs-auth", "error", "unconfigured"],
      default: "unconfigured",
      required: true,
    },
    statusDetail: { type: String, maxlength: 2_000 },
    lastCheckedAt: { type: Date },
  },
  { collection: "connectors", timestamps: true, minimize: false },
);

ConnectorSchema.index({ "oauth.stateHash": 1 }, { sparse: true });

export const Connector =
  existingModel<IConnector>("Connector") ||
  mongoose.model<IConnector>("Connector", ConnectorSchema);
