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

/**
 * The password policy the API enforces. Exported so client-side forms gate on
 * the same numbers rather than restating them and drifting.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export const completeSignupInputSchema = z.object({
  username: z.string().min(1),
  email: z.email(),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
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

export const adminResetMfaInputSchema = z.object({
  userId: z.uuid(),
});
export type AdminResetMfaInput = z.infer<typeof adminResetMfaInputSchema>;

// One-time sign-in links. `email` mails the link to the account's own
// address; `copy` hands it back once, for the owner to pass on themselves.
export const SIGN_IN_LINK_DELIVERIES = ["email", "copy"] as const;
export const signInLinkDeliverySchema = z.enum(SIGN_IN_LINK_DELIVERIES);
export type SignInLinkDelivery = z.infer<typeof signInLinkDeliverySchema>;

export const adminSignInLinkInputSchema = z.object({
  userId: z.uuid(),
  delivery: signInLinkDeliverySchema.default("email"),
  /** Where the link lands once signed in; one of the destinations listed. */
  returnTo: z.url().optional(),
  /**
   * The owner vouching for an address that was never confirmed by mail. A
   * link to an unconfirmed address is refused without it.
   */
  confirmEmail: z.boolean().default(false),
});
export type AdminSignInLinkInput = z.input<typeof adminSignInLinkInputSchema>;

export const signInLinkIssuedSchema = z.object({
  delivery: signInLinkDeliverySchema,
  email: z.string(),
  expiresAt: cloudDateTimeSchema,
  /** Present only for `copy`, and only in this one response. */
  url: z.string().optional(),
});
export type SignInLinkIssued = z.infer<typeof signInLinkIssuedSchema>;

export const signInLinkDestinationSchema = z.object({
  origin: z.string(),
  name: z.string(),
});
export type SignInLinkDestination = z.infer<typeof signInLinkDestinationSchema>;

// Devices the twoFactor plugin lets skip the TOTP step. Trust is a cookie
// backed by a verification row; the API can count and revoke the rows but
// cannot tell one device from another, so this is a count, not a list.
export const trustedDevicesSummarySchema = z.object({
  count: z.number().int().min(0),
  nextExpiresAt: cloudDateTimeSchema.nullable(),
});
export type TrustedDevicesSummary = z.infer<typeof trustedDevicesSummarySchema>;

export const trustedDevicesRevokedSchema = z.object({
  revoked: z.number().int().min(0),
});
export type TrustedDevicesRevoked = z.infer<typeof trustedDevicesRevokedSchema>;
