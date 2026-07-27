import { z } from "zod";


export const GithubDeviceCodeSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string().url(),
  expires_in: z.number(),
  interval: z.number(),
});

export type GithubDeviceCode = z.infer<typeof GithubDeviceCodeSchema>;


export const GithubAccessTokenSchema = z.object({
  access_token: z.string(),
  token_type: z.literal("bearer"),
  scope: z.string(),
});


export const GithubAccessTokenPendingSchema = z.object({
  error: z.enum([
    "authorization_pending",
    "slow_down",
    "expired_token",
    "access_denied",
  ]),
  error_description: z.string().optional(),
});


export const GithubTokenResponseSchema = z.union([
  GithubAccessTokenSchema,
  GithubAccessTokenPendingSchema,
]);


export const GithubUserSchema = z.object({
  id: z.number(),
  login: z.string(),
  email: z.string().nullable(),
});