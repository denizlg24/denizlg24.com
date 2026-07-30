import { z } from "zod";

/** Long-lived admin API keys. The secret is only ever returned at mint time. */
export const apiKeySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
export type IApiKeySummary = z.infer<typeof apiKeySummarySchema>;

export const apiKeyListResponseSchema = z.object({
  apiKeys: z.array(apiKeySummarySchema),
});
export type ApiKeyListResponse = z.infer<typeof apiKeyListResponseSchema>;

export const apiKeySecretResponseSchema = z.object({
  apiKey: z.string(),
});
export type ApiKeySecretResponse = z.infer<typeof apiKeySecretResponseSchema>;

/**
 * Instagram token status. `authorizeUrl` is built server-side because the app id
 * and redirect URI are server env — desktop opens it in the system browser since
 * the OAuth callback lands on the web app.
 */
export const instagramTokenStatusSchema = z.object({
  token: z
    .object({
      id: z.string(),
      expiresAt: z.string(),
    })
    .nullable(),
  authorizeUrl: z.string().nullable(),
});
export type InstagramTokenStatus = z.infer<typeof instagramTokenStatusSchema>;
