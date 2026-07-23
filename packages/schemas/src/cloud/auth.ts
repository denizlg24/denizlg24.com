import { z } from "zod";

import {
  apiKeyScopeSchema,
  cloudDateTimeSchema,
  safeUserSchema,
  userRoleSchema,
} from "./common";

export const loginInputSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totpCode: z.string().optional(),
  recoveryCode: z.string().optional(),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const completeSignupInputSchema = z.object({
  username: z.string().min(1),
  email: z.email(),
  password: z.string().min(8).max(128),
  token: z.string().min(1),
});
export type CompleteSignupInput = z.infer<typeof completeSignupInputSchema>;

export const loginResultSchema = z.object({
  expiresAt: cloudDateTimeSchema,
  user: safeUserSchema,
});
export type LoginResult = z.infer<typeof loginResultSchema>;

export const createPendingUserInputSchema = z.object({
  username: z.string().trim().min(1),
  role: userRoleSchema.default("user"),
});
export type CreatePendingUserInput = z.infer<
  typeof createPendingUserInputSchema
>;

export const pendingUserCreatedSchema = z.object({
  signupToken: z.string(),
  user: safeUserSchema,
});
export type PendingUserCreated = z.infer<typeof pendingUserCreatedSchema>;

export const completeSignupResultSchema = z.object({
  requiresTotpEnrollment: z.literal(true),
  user: safeUserSchema,
});
export type CompleteSignupResult = z.infer<typeof completeSignupResultSchema>;

export const totpSetupResultSchema = z.object({
  uri: z.string(),
});
export type TotpSetupResult = z.infer<typeof totpSetupResultSchema>;

export const verifyTotpSetupInputSchema = z.object({
  code: z.string().min(1),
});
export type VerifyTotpSetupInput = z.infer<typeof verifyTotpSetupInputSchema>;

export const verifyTotpSetupResultSchema = z.object({
  recoveryCodes: z.array(z.string()),
});
export type VerifyTotpSetupResult = z.infer<typeof verifyTotpSetupResultSchema>;

export const createApiKeyInputSchema = z.object({
  name: z.string().trim().min(1),
  scopes: z.array(apiKeyScopeSchema).min(1),
  expiresIn: z.string().optional(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeyInputSchema>;

export const createdApiKeySchema = z.object({
  id: z.uuid(),
  key: z.string(),
  prefix: z.string(),
});
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;
