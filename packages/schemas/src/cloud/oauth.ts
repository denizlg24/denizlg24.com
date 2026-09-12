import { z } from "zod";

import { cloudDateTimeSchema } from "./common";

/**
 * Production identities of the authorization server and the resources it
 * issues tokens for. Every app reads its own env override first; these are the
 * values a deployment falls back to, and the values the three parties must
 * agree on — an `aud` the resource server does not expect is a rejected token.
 */
export const CLOUD_AUTH_ISSUER = "https://api.denizlg24.com/api/auth";
export const AUTH_APP_URL = "https://auth.denizlg24.com";
export const OAUTH_RESOURCES = {
  api: "https://api.denizlg24.com",
  web: "https://denizlg24.com",
  mcp: "https://mcp.denizlg24.com/mcp",
} as const;
export type OAuthResourceKey = keyof typeof OAUTH_RESOURCES;

/** The same identities on the local dev ports, used when NODE_ENV is not production. */
export const DEV_CLOUD_AUTH_ISSUER = "http://localhost:3001/api/auth";
export const DEV_AUTH_APP_URL = "http://localhost:3008";
export const DEV_OAUTH_RESOURCES: Record<OAuthResourceKey, string> = {
  api: "http://localhost:3001",
  web: "http://localhost:3000",
  mcp: "http://localhost:3009/mcp",
};

/**
 * The client_credentials scope that lets a first-party service act as the
 * superuser who registered it. Only an administratively created client can
 * hold it; dynamically registered clients never can.
 */
export const OAUTH_SUPERUSER_SCOPE = "superuser";

/**
 * Claim stamped on every user-bound access token. Issuance refuses anyone who
 * is not an active, TOTP-enrolled superuser, so a resource server that sees it
 * on a verified token needs no second lookup.
 */
export const OAUTH_SUPERUSER_CLAIM = "superuser";

/**
 * `native` is a public client: no secret, PKCE mandatory, loopback or
 * private-scheme redirects. It is what an installed app — the desktop — uses,
 * since a secret shipped inside a release binary is not one.
 */
export const oauthClientKindSchema = z.enum([
  "web",
  "native",
  "service",
  "dynamic",
]);
export type OAuthClientKind = z.infer<typeof oauthClientKindSchema>;

export const oauthClientSummarySchema = z.object({
  clientId: z.string(),
  name: z.string().nullable(),
  kind: oauthClientKindSchema,
  redirectUris: z.array(z.string()),
  resources: z.array(z.string()),
  disabled: z.boolean(),
  activeGrants: z.number().int().nonnegative(),
  lastIssuedAt: cloudDateTimeSchema.nullable(),
  createdAt: cloudDateTimeSchema.nullable(),
});
export type OAuthClientSummary = z.infer<typeof oauthClientSummarySchema>;

export const oauthResourceSummarySchema = z.object({
  identifier: z.string(),
  name: z.string(),
});
export type OAuthResourceSummary = z.infer<typeof oauthResourceSummarySchema>;

export const oauthClientListSchema = z.object({
  clients: z.array(oauthClientSummarySchema),
  resources: z.array(oauthResourceSummarySchema),
});
export type OAuthClientList = z.infer<typeof oauthClientListSchema>;

const clientNameSchema = z.string().trim().min(1).max(100);
const resourceListSchema = z.array(z.url()).min(1).max(10);

const redirectUriListSchema = z.array(z.url()).min(1).max(10);

export const createOAuthClientInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("web"),
    name: clientNameSchema,
    redirectUris: redirectUriListSchema,
    resources: resourceListSchema,
  }),
  z.object({
    kind: z.literal("native"),
    name: clientNameSchema,
    redirectUris: redirectUriListSchema,
    resources: resourceListSchema,
  }),
  z.object({
    kind: z.literal("service"),
    name: clientNameSchema,
    resources: resourceListSchema,
  }),
]);
export type CreateOAuthClientInput = z.infer<
  typeof createOAuthClientInputSchema
>;

/** `clientSecret` is null for a public client — there is nothing to show once. */
export const oauthClientCredentialsSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string().nullable(),
});
export type OAuthClientCredentials = z.infer<
  typeof oauthClientCredentialsSchema
>;

/**
 * What an installed app needs to sign in to the web resource, served by the
 * site itself so the binary carries no environment-specific identifiers and
 * cannot drift from the issuer and audience the site verifies against.
 */
export const desktopAuthConfigSchema = z.object({
  issuer: z.url(),
  clientId: z.string().min(1),
  resource: z.url(),
});
export type DesktopAuthConfig = z.infer<typeof desktopAuthConfigSchema>;

export const updateOAuthClientInputSchema = z.object({
  disabled: z.boolean(),
});
export type UpdateOAuthClientInput = z.infer<
  typeof updateOAuthClientInputSchema
>;
