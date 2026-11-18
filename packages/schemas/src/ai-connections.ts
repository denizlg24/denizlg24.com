import { z } from "zod";
import { llmCatalogModelSchema } from "./llm";

export const gatewayTeamSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const gatewayConnectionInputSchema = z
  .object({
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/),
    teamIdOrSlug: gatewayTeamSchema.optional(),
  })
  .strict();
export type GatewayConnectionInput = z.infer<
  typeof gatewayConnectionInputSchema
>;

export const aiConnectionsResponseSchema = z.object({
  gateway: z.object({
    configured: z.boolean(),
    source: z.enum(["stored", "environment", "oauth"]).nullable(),
    status: z.enum(["connected", "unverified", "error", "disconnected"]),
    teamIdOrSlug: z.string().optional(),
    lastError: z.string().optional(),
  }),
  vercelOAuthAvailable: z.boolean(),
});
export type AiConnectionsResponse = z.infer<typeof aiConnectionsResponseSchema>;

export const subscriptionProviderSchema = z.enum([
  "gateway",
  "chatgpt",
  "claude-code",
]);
export type SubscriptionProvider = z.infer<typeof subscriptionProviderSchema>;

/** The protected record exported by our local Sign in with ChatGPT helper. */
export const chatgptCredentialSchema = z.object({
  issuer: z.literal("https://auth.openai.com"),
  subject: z.string().min(1).max(512),
  email: z.email().optional(),
  client_id: z
    .string()
    .min(1)
    .max(256)
    .refine((value) => value !== "dynamic_agent_client"),
  ext_agent_host_id: z.string().startsWith("urn:uuid:").max(100),
  id_token: z.string().min(1).max(32_000),
  access_token: z.string().min(1).max(32_000),
  refresh_token: z.string().min(1).max(32_000),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive().max(86_400),
  scopes: z
    .array(z.string())
    .refine((scopes) =>
      ["chatgpt.tokens.use.direct", "resource.invoke", "offline_access"].every(
        (scope) => scopes.includes(scope),
      ),
    ),
  saved_at: z.iso.datetime(),
});
export type ChatgptCredential = z.infer<typeof chatgptCredentialSchema>;

export const subscriptionUpdateSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("gateway") }),
  z.object({
    provider: z.literal("chatgpt"),
    credentials: chatgptCredentialSchema.optional(),
    model: z.string().trim().min(1).max(200).optional(),
    /** false saves the connection or its default model without selecting it. */
    activate: z.boolean().optional(),
  }),
  z.object({
    provider: z.literal("claude-code"),
    token: z.string().trim().min(1).max(32_000).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    activate: z.boolean().optional(),
  }),
]);

export type SaveAiSubscription = z.infer<typeof subscriptionUpdateSchema>;
export type AiSubscriptionProvider = SubscriptionProvider;

export const aiSubscriptionsResponseSchema = z.object({
  activeProvider: subscriptionProviderSchema,
  chatgpt: z.object({
    configured: z.boolean(),
    model: z.string().nullable(),
    hostId: z.string(),
    accountLabel: z.string().nullable().optional(),
    lastError: z.string().optional(),
  }),
  claude: z.object({ configured: z.boolean(), model: z.string().nullable() }),
});
export type AiSubscriptionsResponse = z.infer<
  typeof aiSubscriptionsResponseSchema
>;
export const disconnectAiSubscriptionResponseSchema =
  aiSubscriptionsResponseSchema.extend({
    revocationConfirmed: z.boolean().nullable(),
  });
export type DisconnectAiSubscriptionResponse = z.infer<
  typeof disconnectAiSubscriptionResponseSchema
>;
export const chatgptModelsResponseSchema = z.object({
  models: z.array(
    z.object({
      slug: z.string(),
      display_name: z.string(),
      visibility: z.string(),
    }),
  ),
});
export type ChatgptModelsResponse = z.infer<typeof chatgptModelsResponseSchema>;

/**
 * A model id names its provider: `claude-code/<model>` and `chatgpt/<slug>`
 * run on the owner's subscriptions, anything else is a Gateway id.
 */
export const SUBSCRIPTION_MODEL_PREFIXES = {
  "claude-code": "claude-code/",
  chatgpt: "chatgpt/",
} as const;
export type SubscriptionModelProvider =
  keyof typeof SUBSCRIPTION_MODEL_PREFIXES;

export function subscriptionModelId(
  provider: SubscriptionModelProvider,
  model: string,
): string {
  return `${SUBSCRIPTION_MODEL_PREFIXES[provider]}${model}`;
}

export function parseSubscriptionModel(
  id: string,
): { provider: SubscriptionModelProvider; model: string } | null {
  for (const provider of ["claude-code", "chatgpt"] as const) {
    const prefix = SUBSCRIPTION_MODEL_PREFIXES[provider];
    if (id.startsWith(prefix) && id.length > prefix.length)
      return { provider, model: id.slice(prefix.length) };
  }
  return null;
}

export function modelProvider(id: string): SubscriptionProvider {
  return parseSubscriptionModel(id)?.provider ?? "gateway";
}

export const aiProviderModelsSchema = z.object({
  provider: subscriptionProviderSchema,
  connected: z.boolean(),
  /** Qualified id of the provider's saved default, when it has one. */
  defaultModel: z.string().nullable(),
  models: z.array(llmCatalogModelSchema),
  stale: z.boolean(),
  error: z.string().optional(),
});
export type AiProviderModels = z.infer<typeof aiProviderModelsSchema>;

export const aiProvidersResponseSchema = z.object({
  activeProvider: subscriptionProviderSchema,
  providers: z.array(aiProviderModelsSchema),
});
export type AiProvidersResponse = z.infer<typeof aiProvidersResponseSchema>;
