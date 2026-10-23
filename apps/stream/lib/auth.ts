import { type AccessToken, createDenizAuth } from "@denizlg24/auth/next";
import { createVerifier } from "@denizlg24/auth/server";

import {
  authIssuer,
  ownerSubject,
  streamBaseUrl,
  streamResource,
  streamTenant,
} from "@/lib/config";

export function sessionCookieName(): string {
  return streamBaseUrl().startsWith("https:")
    ? "__Host-deniz-auth"
    : "deniz-auth";
}

/**
 * Stream is the owner's `family` tenant, so a token carries `tenant` and
 * never `superuser` — the owner's included. Membership of the tenant is the
 * issuer boundary. The owner and explicitly invited account subjects form
 * the household; another tenant user must not gain access to shared profiles.
 */
export function isFamilyToken(token: AccessToken): boolean {
  const tenant = streamTenant();
  const allowed = new Set([
    ownerSubject(),
    ...(process.env.STREAM_FAMILY_SUBJECTS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ]);
  return (
    !token.machine &&
    tenant !== null &&
    token.tenant === tenant &&
    allowed.has(token.userId)
  );
}

export const auth = createDenizAuth(() => ({
  issuer: authIssuer(),
  clientId: process.env.DENIZ_AUTH_CLIENT_ID ?? "",
  clientSecret: process.env.DENIZ_AUTH_CLIENT_SECRET ?? "",
  secret: process.env.DENIZ_AUTH_SECRET ?? "",
  baseUrl: streamBaseUrl(),
  resource: streamResource(),
  cookieName: sessionCookieName(),
  afterSignOutPath: "/sign-in",
  errorPath: "/sign-in",
  authorize: isFamilyToken,
}));

let verifier: ReturnType<typeof createVerifier> | null = null;

export function bearerVerifier() {
  verifier ??= createVerifier({
    issuer: authIssuer(),
    audience: streamResource(),
  });
  return verifier;
}
