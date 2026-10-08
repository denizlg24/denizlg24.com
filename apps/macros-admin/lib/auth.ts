import { type AccessToken, createDenizAuth } from "@denizlg24/auth/next";
import {
  AUTH_APP_URL,
  DEV_AUTH_APP_URL,
  OAUTH_RESOURCES,
  OAUTH_SUPERUSER_CLAIM,
} from "@repo/schemas/cloud";

const isDev = process.env.NODE_ENV !== "production";

export function adminBaseUrl(): string {
  return (
    process.env.MACROS_ADMIN_URL ??
    (isDev ? "http://localhost:3010" : "https://macros-admin.denizlg24.com")
  );
}

export function authAppUrl(): string {
  return (
    process.env.DENIZ_AUTH_APP_URL ?? (isDev ? DEV_AUTH_APP_URL : AUTH_APP_URL)
  );
}

/** The SDK's own default, stated so the proxy can test for it. */
export function sessionCookieName(): string {
  return adminBaseUrl().startsWith("https:")
    ? "__Host-deniz-auth"
    : "deniz-auth";
}

export function isOwnerToken(token: AccessToken): boolean {
  return !token.machine && token.claims[OAUTH_SUPERUSER_CLAIM] === true;
}

export const auth = createDenizAuth(() => ({
  issuer: process.env.DENIZ_AUTH_ISSUER || undefined,
  clientId: process.env.DENIZ_AUTH_CLIENT_ID ?? "",
  clientSecret: process.env.DENIZ_AUTH_CLIENT_SECRET ?? "",
  secret: process.env.DENIZ_AUTH_SECRET ?? "",
  baseUrl: adminBaseUrl(),
  resource: process.env.MACROS_API_RESOURCE ?? OAUTH_RESOURCES.macros,
  cookieName: sessionCookieName(),
  afterSignOutPath: "/sign-in",
  errorPath: "/sign-in",
  authorize: isOwnerToken,
}));
