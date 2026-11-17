import { z } from "zod";

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
  }),
  z.object({
    provider: z.literal("claude-code"),
    token: z.string().trim().min(1).max(32_000).optional(),
    model: z.string().trim().min(1).max(200).optional(),
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
