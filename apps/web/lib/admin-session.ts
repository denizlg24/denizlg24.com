import {
  type CloudAccessToken,
  createAccessTokenVerifier,
} from "@repo/cloud-auth-client/resource";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";
import {
  type CloudOAuthConfig,
  cloudOAuthConfig,
  siteResourceConfig,
  type TokenSet,
} from "./cloud-oauth";

const secure = process.env.NODE_ENV === "production";

/**
 * Never `deniz-cloud.*`: Forge's edge strips every cookie with that prefix
 * before a request reaches the app, which is the whole reason this site keeps
 * a session of its own instead of reading the cloud one.
 */
export const ADMIN_SESSION_COOKIE = secure
  ? "__Host-denizlg24-admin"
  : "denizlg24-admin";
export const OAUTH_FLOW_COOKIE = secure
  ? "__Host-denizlg24-oauth"
  : "denizlg24-oauth";

/** Matches the authorization server's refresh-token lifetime, which slides on every refresh. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const FLOW_MAX_AGE_SECONDS = 10 * 60;

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

const sessionSchema = z.object({
  at: z.string(),
  rt: z.string(),
  exp: z.number(),
});
export type SealedSession = z.infer<typeof sessionSchema>;

const flowSchema = z.object({
  state: z.string(),
  verifier: z.string(),
  destination: z.string(),
});
export type OAuthFlow = z.infer<typeof flowSchema>;

/**
 * Derived from the client secret rather than configured separately: it is
 * already a random server-only value, and rotating it — a security event —
 * then signs every browser out along with it.
 */
async function sealingKey(config: CloudOAuthConfig): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`denizlg24-admin-session\0${config.clientSecret}`),
  );
  return new Uint8Array(digest);
}

async function seal(
  payload: Record<string, unknown>,
  maxAgeSeconds: number,
): Promise<string> {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .encrypt(await sealingKey(cloudOAuthConfig()));
}

async function open(value: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtDecrypt(
      value,
      await sealingKey(cloudOAuthConfig()),
    );
    return payload;
  } catch {
    return null;
  }
}

export async function sealSession(tokens: TokenSet): Promise<string> {
  if (!tokens.refresh_token) {
    throw new Error("Token response carried no refresh token");
  }
  const session: SealedSession = {
    at: tokens.access_token,
    rt: tokens.refresh_token,
    exp: Math.floor(Date.now() / 1000) + tokens.expires_in,
  };
  return seal(session, SESSION_MAX_AGE_SECONDS);
}

export async function openSession(
  value: string | undefined,
): Promise<SealedSession | null> {
  if (!value) return null;
  const parsed = sessionSchema.safeParse(await open(value));
  return parsed.success ? parsed.data : null;
}

export async function sealFlow(flow: OAuthFlow): Promise<string> {
  return seal(flow, FLOW_MAX_AGE_SECONDS);
}

export async function openFlow(
  value: string | undefined,
): Promise<OAuthFlow | null> {
  if (!value) return null;
  const parsed = flowSchema.safeParse(await open(value));
  return parsed.success ? parsed.data : null;
}

export function flowCookieMaxAge(): number {
  return FLOW_MAX_AGE_SECONDS;
}

let verifier: ((token: string) => Promise<CloudAccessToken | null>) | null =
  null;

/** Access tokens bound to this site, verified against the issuer's published keys. */
export function verifySiteAccessToken(
  token: string,
): Promise<CloudAccessToken | null> {
  if (!verifier) {
    // Only the issuer and audience: the MCP server's tokens must verify even
    // on a deployment whose own sign-in client is not configured yet.
    const config = siteResourceConfig();
    verifier = createAccessTokenVerifier({
      issuer: config.issuer,
      audience: config.resource,
    });
  }
  return verifier(token);
}

/** Replaces one cookie in a `Cookie` request header, keeping the rest. */
export function withCookie(
  header: string | null,
  name: string,
  value: string,
): string {
  const others = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${name}=`));
  return [...others, `${name}=${value}`].join("; ");
}
