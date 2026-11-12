import "server-only";
import { timingSafeEqual } from "node:crypto";
import { type AccessToken, createDenizAuth } from "@denizlg24/auth/next";
import {
  bearerToken,
  createAccessTokenVerifier,
  isSuperuserToken,
  looksLikeJwt,
} from "@repo/cloud-auth-client/resource";
import {
  DEV_OAUTH_RESOURCES,
  OAUTH_RESOURCES,
  OAUTH_SUPERUSER_CLAIM,
} from "@repo/schemas/cloud";
import { headers } from "next/headers";
import { cache } from "react";
import { z } from "zod";

export class AccessError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export const apiOrigin = () =>
  process.env.STATUS_CLOUD_API_URL ?? "https://api.denizlg24.com";

const isDev = process.env.NODE_ENV !== "production";

export function publicUrl(): string {
  return (
    process.env.STATUS_PUBLIC_URL ??
    (isDev ? "http://localhost:3007" : "https://status.denizlg24.com")
  );
}

function isOwnerToken(token: AccessToken): boolean {
  return !token.machine && token.claims[OAUTH_SUPERUSER_CLAIM] === true;
}

/**
 * The admin session is a deniz auth sign-in whose token is for the cloud API:
 * Forge's edge strips the cloud cookie, so the same token both gates the admin
 * pages and is forwarded to the API by `cloudRequest`.
 */
export const auth = createDenizAuth(() => ({
  issuer: process.env.STATUS_AUTH_ISSUER || undefined,
  clientId: process.env.DENIZ_AUTH_CLIENT_ID ?? "",
  clientSecret: process.env.DENIZ_AUTH_CLIENT_SECRET ?? "",
  secret: process.env.DENIZ_AUTH_SECRET ?? "",
  baseUrl: publicUrl(),
  resource:
    process.env.STATUS_ADMIN_RESOURCE ??
    (isDev ? DEV_OAUTH_RESOURCES.api : OAUTH_RESOURCES.api),
  cookieName: publicUrl().startsWith("https:")
    ? "__Host-deniz-auth"
    : "deniz-auth",
  afterSignOutPath: "/admin",
  errorPath: "/admin",
  authorize: isOwnerToken,
}));

export function authLoginHref() {
  return auth.loginUrl("/admin");
}

async function ownerAccessToken(): Promise<string | null> {
  const session = await auth.getSession();
  return session && isOwnerToken(session.token) ? session.accessToken : null;
}

export const adminSession = cache(async () => {
  const token = await ownerAccessToken();
  if (!token) return null;
  let response: Response;
  try {
    response = await fetch(new URL("/api/me", apiOrigin()), {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new AccessError(
      503,
      "Cloud authentication is temporarily unavailable. Your session has not been signed out.",
    );
  }
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok)
    throw new AccessError(
      503,
      "Cloud authentication is temporarily unavailable.",
    );
  const parsed = z
    .object({
      data: z.object({
        id: z.string(),
        username: z.string(),
        role: z.string(),
      }),
    })
    .parse(await response.json());
  return parsed.data.role === "superuser" ? parsed.data : null;
});
export async function requireAdmin() {
  const user = await adminSession();
  if (!user)
    throw new AccessError(403, "An administrator session is required.");
  return user;
}
export type Actor = { id: string; username: string };

/**
 * This page's own audience. The MCP server calls the admin API with a token
 * the authorization server issued for `https://status.denizlg24.com`; a token
 * for any other resource is refused, as everywhere else.
 */
function resourceConfig() {
  const production = process.env.NODE_ENV === "production";
  return {
    issuer: (
      process.env.STATUS_AUTH_ISSUER ?? `${apiOrigin()}/api/auth`
    ).replace(/\/$/, ""),
    audience:
      process.env.STATUS_OAUTH_RESOURCE ??
      (production ? OAUTH_RESOURCES.status : DEV_OAUTH_RESOURCES.status),
  };
}
let verifier: ReturnType<typeof createAccessTokenVerifier> | undefined;
async function bearerActor(request: Request): Promise<Actor | null> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token || !looksLikeJwt(token)) return null;
  verifier ??= createAccessTokenVerifier(resourceConfig());
  let verified: Awaited<ReturnType<typeof verifier>>;
  try {
    verified = await verifier(token);
  } catch {
    throw new AccessError(
      503,
      "Cloud authentication is temporarily unavailable.",
    );
  }
  if (!verified || !isSuperuserToken(verified)) return null;
  const name = verified.machine
    ? `client:${verified.clientId}`
    : verified.subject;
  return { id: name, username: name };
}
/** Who is calling the admin API: a bearer token first, the admin cookie otherwise. */
export async function requireActor(request: Request): Promise<Actor> {
  const bearer = await bearerActor(request);
  if (bearer) return bearer;
  if (request.headers.get("authorization"))
    throw new AccessError(401, "The bearer token was not accepted.");
  const session = await adminSession();
  if (!session)
    throw new AccessError(
      401,
      "An administrator token or session is required.",
    );
  return { id: session.id, username: session.username };
}
export async function requireSameOrigin() {
  const origin = (await headers()).get("origin");
  const allowed = new Set([publicUrl()]);
  if (process.env.NODE_ENV !== "production")
    allowed.add("http://localhost:3007");
  if (!origin || !allowed.has(origin))
    throw new AccessError(403, "Invalid request origin");
}
export function validBearer(header: string | null, token: string | undefined) {
  if (!token || token.length < 32 || !header?.startsWith("Bearer "))
    return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
export async function cloudRequest(path: string, init: RequestInit = {}) {
  await requireAdmin();
  const token = await ownerAccessToken();
  if (!token)
    throw new AccessError(403, "An administrator session is required.");
  const response = await fetch(new URL(path, apiOrigin()), {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new AccessError(
      response.status,
      `Cloud operation failed (HTTP ${response.status}).`,
    );
  return response.json() as Promise<unknown>;
}
