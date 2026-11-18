import { randomUUID } from "node:crypto";
import { subscriptionModelId } from "@repo/schemas";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "@/lib/encrypted-secret";
import { LlmConfigurationError } from "@/lib/llm-errors";
import { invalidateModelSettings } from "@/lib/llm-model-settings";
import {
  type ClaudeSubscriptionModel,
  listClaudeSubscriptionModels,
} from "@/lib/llm-transports/claude-subscription";
import { connectDB } from "@/lib/mongodb";
import { AiSubscriptionSettings } from "@/models/AiSubscriptionSettings";
import {
  type ChatgptCredential,
  chatgptCredentialSchema,
  chatgptTokenResponseSchema,
  credentialExpiresAt,
  type SubscriptionProvider,
  type subscriptionUpdateSchema,
} from "./contract";

const jwks = createRemoteJWKSet(
  new URL("https://auth.openai.com/.well-known/jwks.json"),
);
const modelCatalogSchema = z.object({
  models: z.array(
    z.object({
      slug: z.string(),
      display_name: z.string(),
      visibility: z.string(),
    }),
  ),
});

async function settings() {
  await connectDB();
  const current = await AiSubscriptionSettings.findById("singleton").lean();
  if (current) return current;
  return AiSubscriptionSettings.findOneAndUpdate(
    { _id: "singleton" },
    {
      $setOnInsert: {
        activeProvider: "gateway",
        hostId: `urn:uuid:${randomUUID()}`,
      },
    },
    { upsert: true, returnDocument: "after" },
  )
    .lean()
    .orFail();
}

export async function subscriptionStatus() {
  const row = await settings();
  return {
    activeProvider: row.activeProvider,
    chatgpt: {
      configured: !!row.chatgpt,
      model: row.chatgpt?.model ?? null,
      hostId: row.hostId,
      accountLabel: row.chatgpt?.label ?? null,
      ...(row.chatgpt?.renewalFailed
        ? {
            lastError:
              "ChatGPT needs a fresh sign-in. Run the local helper and import the new file.",
          }
        : {}),
    },
    claude: { configured: !!row.claude, model: row.claude?.model ?? null },
  };
}

export async function subscriptionSelection() {
  const row = await settings();
  return {
    provider: row.activeProvider,
    model:
      row.activeProvider === "chatgpt" ? row.chatgpt?.model : row.claude?.model,
  };
}

/** Imports only the documented SIWC plan-usage record; API keys are not accepted. */
export async function updateSubscription(
  input: z.infer<typeof subscriptionUpdateSchema>,
) {
  const row = await settings();
  if (input.provider === "gateway") {
    await AiSubscriptionSettings.updateOne(
      { _id: "singleton" },
      { $set: { activeProvider: "gateway" } },
    );
  } else if (input.provider === "claude-code") {
    if (!input.token && !row.claude)
      throw new LlmConfigurationError(
        "Connect Claude first using your own setup token.",
      );
    if (input.token && !input.token.startsWith("sk-ant-oat"))
      throw new LlmConfigurationError(
        "Use a Claude Code subscription setup token, not an Anthropic API key.",
      );
    const token = input.token ?? (await claudeSubscriptionCredential()).token;
    const available = await claudeModelsForToken(
      token,
      input.token ? undefined : row.claude?.revision,
    );
    const requested = input.model ?? row.claude?.model;
    const model = requested ? stripClaudePrefix(requested) : available[0]?.id;
    if (!model)
      throw new LlmConfigurationError("This Claude account lists no models.");
    if (!available.some((entry) => entry.id === model))
      throw new LlmConfigurationError(
        "Choose a model available to this Claude account.",
      );
    const activate =
      input.activate !== false
        ? { activeProvider: "claude-code" as const }
        : {};
    if (input.token) {
      const revision = randomUUID();
      claudeModelCache = { revision, models: available, at: Date.now() };
      await AiSubscriptionSettings.updateOne(
        { _id: "singleton" },
        {
          $set: {
            ...activate,
            claude: { secret: encryptSecret(input.token), model, revision },
          },
        },
      );
    } else {
      await AiSubscriptionSettings.updateOne(
        { _id: "singleton" },
        { $set: { ...activate, "claude.model": model } },
      );
    }
  } else {
    const requested = input.model ?? row.chatgpt?.model;
    const model = requested?.replace(/^chatgpt\//, "");
    if (!model)
      throw new LlmConfigurationError(
        "Choose a model from your ChatGPT account.",
      );
    if (!input.credentials && !row.chatgpt)
      throw new LlmConfigurationError(
        "Import a ChatGPT connection from the local sign-in helper first.",
      );
    if (input.credentials) {
      const record = input.credentials;
      // Prove the token authorizes plan usage, rather than an identity-only login.
      const models = await importedChatgptModels(record);
      if (!models.some((entry) => entry.slug === model))
        throw new LlmConfigurationError(
          "Choose a model available to this ChatGPT account.",
        );
      // A VM keeps its own host identity when importing a laptop's protected record.
      await AiSubscriptionSettings.updateOne(
        { _id: "singleton" },
        {
          $set: {
            ...(input.activate !== false
              ? { activeProvider: "chatgpt" as const }
              : {}),
            chatgpt: {
              secret: encryptSecret(
                JSON.stringify({ ...record, ext_agent_host_id: row.hostId }),
              ),
              model,
              label: record.email ?? record.subject,
              expiresAt: credentialExpiresAt(record),
              revision: randomUUID(),
            },
          },
        },
      );
    } else {
      const models = await chatgptModelsCached();
      if (!models.some((entry) => entry.slug === model))
        throw new LlmConfigurationError(
          "Choose a model available to this ChatGPT account.",
        );
      await AiSubscriptionSettings.updateOne(
        { _id: "singleton" },
        {
          $set: {
            ...(input.activate !== false
              ? { activeProvider: "chatgpt" as const }
              : {}),
            "chatgpt.model": model,
          },
        },
      );
    }
  }
  invalidateModelSettings();
  return subscriptionStatus();
}

export async function disconnectSubscription(provider: SubscriptionProvider) {
  if (provider === "gateway")
    throw new LlmConfigurationError(
      "Disconnect Gateway in its connection settings.",
    );
  await connectDB();
  const field = provider === "chatgpt" ? "chatgpt" : "claude";
  const row = await settings();
  const connection = row[field];
  // Keep the selected provider: disconnect must never start charging Gateway implicitly.
  if (connection) {
    const removed = await AiSubscriptionSettings.updateOne(
      { _id: "singleton", [`${field}.revision`]: connection.revision },
      { $unset: { [field]: "" } },
    );
    if (removed.modifiedCount !== 1)
      throw new LlmConfigurationError(
        "The connection changed. Refresh settings and disconnect again.",
      );
  }
  let revocationConfirmed: boolean | null = null;
  if (provider === "chatgpt" && connection) {
    try {
      revocationConfirmed = await revokeChatgptSession(
        chatgptCredentialSchema.parse(
          JSON.parse(decryptSecret(connection.secret)),
        ),
      );
    } catch {
      revocationConfirmed = false;
    }
  }
  invalidateModelSettings();
  return { ...(await subscriptionStatus()), revocationConfirmed };
}

async function revokeChatgptSession(
  record: ChatgptCredential,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(
        "https://auth.openai.com/api/accounts/oauth/revoke",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: record.refresh_token,
            token_type_hint: "refresh_token",
            client_id: record.client_id,
          }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (response.ok) return true;
      if (response.status < 500) return false;
    } catch {
      /* Local removal succeeds even when remote revocation is unavailable. */
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

export async function claudeSubscriptionCredential() {
  const row = await settings();
  if (!row.claude)
    throw new LlmConfigurationError(
      "Claude Code is disconnected. Connect it in Models settings.",
    );
  try {
    return { token: decryptSecret(row.claude.secret), model: row.claude.model };
  } catch {
    throw new LlmConfigurationError(
      "The stored Claude connection cannot be read. Replace its setup token in Models settings.",
    );
  }
}

export async function chatgptModels(accessToken: string) {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new LlmConfigurationError(
      `ChatGPT connection failed (${response.status}). Sign in again or check plan access.`,
    );
  return modelCatalogSchema
    .parse(await response.json())
    .models.filter((model) => model.visibility === "list");
}

export async function importedChatgptModels(record: ChatgptCredential) {
  const { payload } = await jwtVerify(record.id_token, jwks, {
    issuer: record.issuer,
    audience: record.client_id,
  });
  if (payload.sub !== record.subject)
    throw new LlmConfigurationError(
      "The ChatGPT identity does not match this connection.",
    );
  return chatgptModels(record.access_token);
}

export async function chatgptAccessToken(): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const row = await settings();
    const connection = row.chatgpt;
    if (!connection)
      throw new LlmConfigurationError(
        "ChatGPT is disconnected. Connect it in Models settings.",
      );
    if (connection.renewalFailed)
      throw new LlmConfigurationError(
        "ChatGPT needs a fresh sign-in. Run the local helper again.",
      );
    if (
      connection.refreshUntil &&
      connection.refreshUntil.getTime() <= Date.now()
    ) {
      await AiSubscriptionSettings.updateOne(
        { _id: "singleton", "chatgpt.revision": connection.revision },
        { $set: { "chatgpt.renewalFailed": true } },
      );
      throw new LlmConfigurationError(
        "ChatGPT token renewal was interrupted. Run the local sign-in helper again.",
      );
    }
    let record: ChatgptCredential;
    try {
      record = chatgptCredentialSchema.parse(
        JSON.parse(decryptSecret(connection.secret)),
      );
    } catch {
      throw new LlmConfigurationError(
        "The stored ChatGPT connection cannot be read. Import a fresh sign-in file.",
      );
    }
    if (credentialExpiresAt(record).getTime() > Date.now() + 60_000)
      return record.access_token;
    const claimed = await AiSubscriptionSettings.findOneAndUpdate(
      {
        _id: "singleton",
        "chatgpt.revision": connection.revision,
        "chatgpt.refreshUntil": { $exists: false },
      },
      { $set: { "chatgpt.refreshUntil": new Date(Date.now() + 30_000) } },
      { returnDocument: "after" },
    ).lean();
    if (!claimed) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }
    try {
      const response = await fetch(
        "https://auth.openai.com/api/accounts/oauth/token",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: record.client_id,
            refresh_token: record.refresh_token,
            resource: "https://api.openai.com/v1",
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok)
        throw new LlmConfigurationError(
          "ChatGPT sign-in expired or was revoked. Run the local sign-in helper again.",
        );
      const refreshed = chatgptTokenResponseSchema.parse(await response.json());
      const next: ChatgptCredential = chatgptCredentialSchema.parse({
        ...record,
        ...refreshed,
        id_token: refreshed.id_token ?? record.id_token,
        scopes: refreshed.scope.split(/\s+/),
        saved_at: new Date().toISOString(),
      });
      const saved = await AiSubscriptionSettings.updateOne(
        { _id: "singleton", "chatgpt.revision": connection.revision },
        {
          $set: {
            "chatgpt.secret": encryptSecret(JSON.stringify(next)),
            "chatgpt.expiresAt": credentialExpiresAt(next),
            "chatgpt.revision": randomUUID(),
          },
          $unset: { "chatgpt.refreshUntil": "" },
        },
      );
      if (saved.modifiedCount !== 1) {
        await revokeChatgptSession(next);
        throw new LlmConfigurationError(
          "The ChatGPT connection changed while refreshing. Retry the request.",
        );
      }
      return next.access_token;
    } catch (error) {
      // A lost token-exchange response may have consumed a single-use refresh
      // token. Require reauthorization instead of replaying it on a later call.
      await AiSubscriptionSettings.updateOne(
        { _id: "singleton", "chatgpt.revision": connection.revision },
        {
          $set: { "chatgpt.renewalFailed": true },
          $unset: { "chatgpt.refreshUntil": "" },
        },
      );
      throw error;
    }
  }
  throw new LlmConfigurationError(
    "ChatGPT is renewing its connection. Retry in a moment.",
  );
}

function stripClaudePrefix(model: string) {
  return model.replace(/^(claude-code|anthropic)\//, "");
}

const CLAUDE_MODELS_TTL_MS = 6 * 60 * 60_000;
const CHATGPT_MODELS_TTL_MS = 10 * 60_000;
let claudeModelCache: {
  revision: string;
  models: ClaudeSubscriptionModel[];
  at: number;
} | null = null;
let chatgptModelCache: {
  revision: string;
  models: Awaited<ReturnType<typeof chatgptModels>>;
  at: number;
} | null = null;

/** Listing spawns a runtime, so a saved connection's answer is reused per revision. */
async function claudeModelsForToken(token: string, revision?: string) {
  if (
    revision &&
    claudeModelCache?.revision === revision &&
    Date.now() - claudeModelCache.at < CLAUDE_MODELS_TTL_MS
  )
    return claudeModelCache.models;
  try {
    const models = await listClaudeSubscriptionModels(token);
    if (revision) claudeModelCache = { revision, models, at: Date.now() };
    return models;
  } catch (error) {
    throw new LlmConfigurationError(
      error instanceof Error ? error.message : "Could not list Claude models.",
    );
  }
}

export async function claudeModels() {
  const row = await settings();
  if (!row.claude) throw new LlmConfigurationError("Claude is not connected.");
  const { token } = await claudeSubscriptionCredential();
  return claudeModelsForToken(token, row.claude.revision);
}

export async function chatgptModelsCached() {
  const row = await settings();
  const revision = row.chatgpt?.revision;
  if (
    revision &&
    chatgptModelCache?.revision === revision &&
    Date.now() - chatgptModelCache.at < CHATGPT_MODELS_TTL_MS
  )
    return chatgptModelCache.models;
  const models = await chatgptModels(await chatgptAccessToken());
  if (revision) chatgptModelCache = { revision, models, at: Date.now() };
  return models;
}

/** The active subscription's saved model as a qualified id; null on Gateway. */
export async function activeSubscriptionModel(): Promise<string | null> {
  const row = await settings();
  if (row.activeProvider === "claude-code" && row.claude?.model)
    return subscriptionModelId("claude-code", row.claude.model);
  if (row.activeProvider === "chatgpt" && row.chatgpt?.model)
    return subscriptionModelId("chatgpt", row.chatgpt.model);
  return null;
}
