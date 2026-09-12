import {
  CLOUD_AUTH_ISSUER,
  DEV_CLOUD_AUTH_ISSUER,
  DEV_OAUTH_RESOURCES,
  OAUTH_RESOURCES,
} from "@repo/schemas/cloud";
import { z } from "zod";

const production = process.env.NODE_ENV === "production";

/** What it takes to verify a token for this site — no client credentials. */
export interface SiteResourceConfig {
  issuer: string;
  /** This site's resource identifier — the audience of its access tokens. */
  resource: string;
}

export interface CloudOAuthConfig extends SiteResourceConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function siteResourceConfig(): SiteResourceConfig {
  return {
    issuer: (
      process.env.CLOUD_AUTH_ISSUER ??
      (production ? CLOUD_AUTH_ISSUER : DEV_CLOUD_AUTH_ISSUER)
    ).replace(/\/$/, ""),
    resource:
      process.env.OAUTH_RESOURCE_WEB ??
      (production ? OAUTH_RESOURCES.web : DEV_OAUTH_RESOURCES.web),
  };
}

/**
 * Read lazily: `next build` imports route modules without the runtime env, and
 * a missing client must surface as a failed sign-in, not a failed build.
 */
export function cloudOAuthConfig(): CloudOAuthConfig {
  const clientId = process.env.WEB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.WEB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "WEB_OAUTH_CLIENT_ID and WEB_OAUTH_CLIENT_SECRET are required",
    );
  }
  const resource = siteResourceConfig();
  const site = (process.env.WEB_PUBLIC_URL ?? resource.resource).replace(
    /\/$/,
    "",
  );
  return {
    ...resource,
    clientId,
    clientSecret,
    redirectUri: `${site}/auth/callback`,
  };
}

const tokenSetSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
});
export type TokenSet = z.infer<typeof tokenSetSchema>;

export class OAuthGrantError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`Token endpoint refused the grant (${status} ${code ?? ""})`);
  }

  /** The grant itself is dead — revoked, expired, replayed — not the network. */
  get grantInvalid(): boolean {
    return this.status === 400 || this.status === 401 || this.status === 403;
  }
}

function basicAuth(config: CloudOAuthConfig): string {
  const pair = `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`;
  return `Basic ${Buffer.from(pair).toString("base64")}`;
}

async function tokenRequest(
  config: CloudOAuthConfig,
  params: Record<string, string>,
): Promise<TokenSet> {
  const response = await fetch(`${config.issuer}/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: basicAuth(config),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const code =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : undefined;
    throw new OAuthGrantError(response.status, code);
  }
  return tokenSetSchema.parse(await response.json());
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

export async function authorizationUrl(
  config: CloudOAuthConfig,
  input: { state: string; verifier: string },
): Promise<string> {
  const url = new URL(`${config.issuer}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "openid offline_access",
    resource: config.resource,
    state: input.state,
    code_challenge: await codeChallenge(input.verifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export function exchangeCode(
  config: CloudOAuthConfig,
  input: { code: string; verifier: string },
): Promise<TokenSet> {
  return tokenRequest(config, {
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: config.redirectUri,
    resource: config.resource,
  });
}

// One page load fires several requests that all find the same expired token.
// The server tolerates a replayed refresh for a few seconds, but only one
// request per token needs to reach it at all.
const refreshing = new Map<string, Promise<TokenSet>>();

export function refreshTokens(
  config: CloudOAuthConfig,
  refreshToken: string,
): Promise<TokenSet> {
  const pending = refreshing.get(refreshToken);
  if (pending) return pending;
  const request = tokenRequest(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    resource: config.resource,
  }).finally(() => {
    setTimeout(() => refreshing.delete(refreshToken), 5_000);
  });
  refreshing.set(refreshToken, request);
  return request;
}

export async function revokeRefreshToken(
  config: CloudOAuthConfig,
  refreshToken: string,
): Promise<void> {
  await fetch(`${config.issuer}/oauth2/revoke`, {
    method: "POST",
    headers: {
      authorization: basicAuth(config),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      token: refreshToken,
      token_type_hint: "refresh_token",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}
