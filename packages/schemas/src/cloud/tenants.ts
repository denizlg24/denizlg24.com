import { z } from "zod";

import { MIN_PASSWORD_LENGTH } from "./auth";
import { cloudDateTimeSchema } from "./common";
import { oauthClientSummarySchema, oauthResourceSummarySchema } from "./oauth";

/**
 * Claim stamped on every token issued to a tenant's client. First-party
 * tokens never carry it, and tenant tokens never carry `superuser` — even
 * when the person signing in is the owner.
 */
export const OAUTH_TENANT_CLAIM = "tenant";

/**
 * The client_credentials scope a tenant's service client holds. The plugin
 * requires one; it grants nothing beyond being a machine of that tenant.
 */
export const OAUTH_SERVICE_SCOPE = "service";

export const authRealmSchema = z.enum(["cloud", "public"]);
export type AuthRealm = z.infer<typeof authRealmSchema>;

export const tenantSignupPolicySchema = z.enum(["open", "invite", "closed"]);
export type TenantSignupPolicy = z.infer<typeof tenantSignupPolicySchema>;

export const tenantMfaPolicySchema = z.enum(["required", "optional"]);
export type TenantMfaPolicy = z.infer<typeof tenantMfaPolicySchema>;

export const tenantMemberRoleSchema = z.enum(["owner", "admin"]);
export type TenantMemberRole = z.infer<typeof tenantMemberRoleSchema>;

export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, {
    message: "Lowercase letters, digits and dashes; 1–40 characters",
  });

const httpsUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Must be an https URL",
  });

const tenantProfileShape = {
  name: z.string().trim().min(1).max(80),
  logoUrl: httpsUrlSchema.nullable().optional(),
  homepageUrl: httpsUrlSchema.nullable().optional(),
  privacyUrl: httpsUrlSchema.nullable().optional(),
  termsUrl: httpsUrlSchema.nullable().optional(),
  signup: tenantSignupPolicySchema.optional(),
  mfa: tenantMfaPolicySchema.optional(),
  requireVerifiedEmail: z.boolean().optional(),
};

export const createTenantInputSchema = z.object({
  slug: tenantSlugSchema,
  ...tenantProfileShape,
});
export type CreateTenantInput = z.infer<typeof createTenantInputSchema>;

export const updateTenantInputSchema = z
  .object({
    ...tenantProfileShape,
    name: tenantProfileShape.name.optional(),
    disabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });
export type UpdateTenantInput = z.infer<typeof updateTenantInputSchema>;

export const tenantSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  homepageUrl: z.string().nullable(),
  privacyUrl: z.string().nullable(),
  termsUrl: z.string().nullable(),
  signup: tenantSignupPolicySchema,
  mfa: tenantMfaPolicySchema,
  requireVerifiedEmail: z.boolean(),
  disabled: z.boolean(),
  /** How the caller relates to it; the owner of the whole service sees every tenant. */
  access: z.enum(["owner", "admin", "superuser"]),
  clientCount: z.number().int().nonnegative(),
  userCount: z.number().int().nonnegative(),
  createdAt: cloudDateTimeSchema,
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;

export const tenantMemberSchema = z.object({
  userId: z.string(),
  username: z.string().nullable(),
  email: z.string(),
  name: z.string(),
  role: tenantMemberRoleSchema,
  createdAt: cloudDateTimeSchema,
});
export type TenantMember = z.infer<typeof tenantMemberSchema>;

export const tenantDetailSchema = z.object({
  tenant: tenantSummarySchema,
  clients: z.array(oauthClientSummarySchema),
  resources: z.array(oauthResourceSummarySchema),
  members: z.array(tenantMemberSchema),
});
export type TenantDetail = z.infer<typeof tenantDetailSchema>;

export const createTenantResourceInputSchema = z.object({
  identifier: httpsUrlSchema,
  name: z.string().trim().min(1).max(80),
});
export type CreateTenantResourceInput = z.infer<
  typeof createTenantResourceInputSchema
>;

export const addTenantMemberInputSchema = z.object({
  /** Username or email of an existing deniz account. */
  account: z.string().trim().min(1).max(255),
  role: tenantMemberRoleSchema.default("admin"),
});
export type AddTenantMemberInput = z.infer<typeof addTenantMemberInputSchema>;

export const tenantUserSchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  email: z.string(),
  name: z.string(),
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
  /** Client ids this person has granted access to. */
  clients: z.array(z.string()),
  firstGrantedAt: cloudDateTimeSchema.nullable(),
  lastIssuedAt: cloudDateTimeSchema.nullable(),
  blocked: z.boolean(),
});
export type TenantUser = z.infer<typeof tenantUserSchema>;

export const tenantUserListSchema = z.object({
  users: z.array(tenantUserSchema),
  total: z.number().int().nonnegative(),
});
export type TenantUserList = z.infer<typeof tenantUserListSchema>;

export const blockTenantUserInputSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type BlockTenantUserInput = z.infer<typeof blockTenantUserInputSchema>;

/** What the sign-in screens may show about the app someone is signing in to. Public. */
export const publicTenantSchema = z.object({
  slug: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  homepageUrl: z.string().nullable(),
  privacyUrl: z.string().nullable(),
  termsUrl: z.string().nullable(),
  signup: tenantSignupPolicySchema,
  mfa: tenantMfaPolicySchema,
});
export type PublicTenant = z.infer<typeof publicTenantSchema>;

export const connectedAppSchema = z.object({
  clientId: z.string(),
  name: z.string().nullable(),
  uri: z.string().nullable(),
  tenant: z
    .object({
      slug: z.string(),
      name: z.string(),
      logoUrl: z.string().nullable(),
    })
    .nullable(),
  scopes: z.array(z.string()),
  grantedAt: cloudDateTimeSchema.nullable(),
  lastIssuedAt: cloudDateTimeSchema.nullable(),
});
export type ConnectedApp = z.infer<typeof connectedAppSchema>;

export const accountSummarySchema = z.object({
  id: z.string(),
  realm: authRealmSchema,
  username: z.string().nullable(),
  email: z.string(),
  emailVerified: z.boolean(),
  name: z.string(),
  twoFactorEnabled: z.boolean(),
  /** Tenants this account manages, for the auth app's navigation. */
  tenants: z.array(z.object({ slug: z.string(), name: z.string() })),
  superuser: z.boolean(),
});
export type AccountSummary = z.infer<typeof accountSummarySchema>;

/**
 * Self-service sign-up happens inside an authorization: `clientId` names the
 * app the person is signing up for, and that app's tenant must allow it.
 */
export const publicSignUpInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().trim().toLowerCase().max(255),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(128),
  clientId: z.string().min(1).max(255),
  /**
   * Where the verification link lands, signed in: usually the authorization
   * URL the person started from, so verifying resumes it. Must be on the
   * API or the auth app.
   */
  callbackURL: z.url().optional(),
});
export type PublicSignUpInput = z.infer<typeof publicSignUpInputSchema>;

/**
 * Identical whether or not the address already had an account, so the
 * endpoint cannot be used to test which addresses are registered. The
 * verification link is what signs a new account in.
 */
export const publicSignUpResultSchema = z.object({
  verificationSent: z.literal(true),
});
export type PublicSignUpResult = z.infer<typeof publicSignUpResultSchema>;
