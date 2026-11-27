import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import * as oidc from "openid-client";
import { cache } from "react";
import { type Identity, sessionIdentity } from "./db";

export const issuer = () =>
  process.env.DENIZ_OIDC_ISSUER ?? "https://api.denizlg24.com/api/auth";
export const authReady = () =>
  Boolean(
    process.env.DENIZ_OIDC_CLIENT_ID &&
      process.env.DENIZ_OIDC_CLIENT_SECRET &&
      process.env.APP_URL,
  );
export const demoEnabled = () =>
  process.env.DEMO_MODE === "1" ||
  (process.env.DEMO_MODE !== "0" && process.env.NODE_ENV === "development");

export function appOrigin(request?: Request): string {
  if (process.env.APP_URL) {
    const url = new URL(process.env.APP_URL);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
      throw new Error("APP_URL must use HTTPS.");
    return url.origin;
  }
  if (request && demoEnabled()) return new URL(request.url).origin;
  throw new Error("APP_URL is required");
}

export const authAppUrl = () =>
  (process.env.DENIZ_AUTH_APP_URL ?? "https://auth.denizlg24.com").replace(
    /\/$/,
    "",
  );

/**
 * A page on deniz auth, where the account's name, password and two-factor are
 * managed. With the client id and a return URL on one of this client's
 * registered origins, deniz auth shows a "Back to Stockwatcher" link.
 */
export function authAccountUrl(
  page: "account" | "security",
  section?: string,
): string {
  const url = new URL(`/${page}`, authAppUrl());
  const clientId = process.env.DENIZ_OIDC_CLIENT_ID;
  if (clientId && process.env.APP_URL) {
    url.searchParams.set("client_id", clientId);
    url.searchParams.set(
      "returnTo",
      `${appOrigin()}/account#${page === "account" ? "profile" : "security"}`,
    );
  }
  if (section) url.hash = section;
  return url.toString();
}

export const sessionCookie = (origin: string) =>
  origin.startsWith("https:") ? "__Host-stockwatcher" : "stockwatcher";
export const flowCookie = (origin: string) =>
  origin.startsWith("https:")
    ? "__Host-stockwatcher_oauth"
    : "stockwatcher_oauth";
export const cookieOptions = (origin: string, maxAge: number) => ({
  httpOnly: true,
  secure: origin.startsWith("https:"),
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

export function accountAllowed(identity: Identity) {
  if (identity.demo) return demoEnabled();
  const allowed = process.env.WORKSPACE_ALLOWED_EMAILS?.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed?.length) return true;
  return (
    identity.emailVerified === true &&
    Boolean(identity.email && allowed.includes(identity.email.toLowerCase()))
  );
}

// Deniz Cloud never puts a superuser claim on tenant-client tokens, so admin
// access is granted by configuration: a list of Deniz Cloud subjects.
export function isAdmin(identity: Identity) {
  if (identity.demo) return false;
  const subjects = new Set(
    (process.env.STOCKWATCHER_ADMIN_SUBJECTS ?? "")
      .split(",")
      .map((subject) => subject.trim())
      .filter(Boolean),
  );
  if (!subjects.size) return false;
  if (subjects.has(identity.id)) return true;
  const split = identity.id.lastIndexOf("|");
  if (split < 0) return false;
  return (
    identity.id.slice(0, split) === issuer() &&
    subjects.has(identity.id.slice(split + 1))
  );
}

export const currentUser = cache(async () => {
  const jar = await cookies();
  const secure = process.env.APP_URL?.startsWith("https:") ?? false;
  const token = jar.get(secure ? "__Host-stockwatcher" : "stockwatcher")?.value;
  const identity = await sessionIdentity(token);
  return identity && accountAllowed(identity) ? identity : null;
});

let configuration: Promise<oidc.Configuration> | undefined;
export function oidcConfiguration() {
  if (!authReady()) throw new Error("Deniz Cloud sign-in is not configured");
  if (!configuration) {
    configuration = oidc
      .discovery(
        new URL(issuer()),
        process.env.DENIZ_OIDC_CLIENT_ID!,
        { client_secret: process.env.DENIZ_OIDC_CLIENT_SECRET! },
        oidc.ClientSecretBasic(process.env.DENIZ_OIDC_CLIENT_SECRET!),
        process.env.OIDC_TEST_ALLOW_HTTP === "1" &&
          process.env.DEMO_MODE === "1"
          ? { execute: [oidc.allowInsecureRequests] }
          : undefined,
      )
      .then((config) => {
        oidc.enableNonRepudiationChecks(config);
        config.timeout = 8;
        return config;
      })
      .catch((error) => {
        configuration = undefined;
        throw error;
      });
  }
  return configuration;
}

export function sameOrigin(request: Request) {
  const expected = process.env.APP_URL
    ? appOrigin()
    : new URL(request.url).origin;
  return request.headers.get("origin") === expected;
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
