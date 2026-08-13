import type { Database } from "@repo/cloud-core";
import { deployments, users } from "@repo/cloud-core/db/schema";
import { FORGE_PREVIEW_SHARE_QUERY } from "@repo/schemas/cloud";
import { eq } from "drizzle-orm";

import type { CloudAuth } from "../auth/better-auth";
import { verifyPreviewShareToken } from "./preview-share";

export const PREVIEW_SHARE_COOKIE = "__Host-forge-preview-share";

export interface PreviewAuthorizationOptions {
  auth: CloudAuth;
  db: Database;
  loginUrl: string;
  secret: string;
  now?: () => number;
}

function forwardedHostname(request: Request): string | null {
  const value = request.headers.get("x-forwarded-host")?.trim().toLowerCase();
  if (!value || value.includes(",")) return null;
  try {
    const url = new URL(`https://${value}`);
    return url.port ? null : url.hostname;
  } catch {
    return null;
  }
}

function originalUrl(request: Request, hostname: string): URL | null {
  const uri = request.headers.get("x-forwarded-uri") ?? "/";
  // An origin-form URI is the only value Caddy sends. Refusing network-path
  // references keeps a forged header from turning either redirect into one to
  // an unrelated host.
  if (!uri.startsWith("/") || uri.startsWith("//")) return null;
  try {
    const url = new URL(uri, `https://${hostname}`);
    return url.protocol === "https:" && url.hostname === hostname ? url : null;
  } catch {
    return null;
  }
}

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim() || null;
  }
  return null;
}

function noStore(headers: Headers) {
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
}

/**
 * Caddy's forward-auth target. A 2xx continues to the deployment; every other
 * response is returned to the browser unchanged.
 */
export async function authorizePreviewRequest(
  request: Request,
  options: PreviewAuthorizationOptions,
): Promise<Response> {
  const hostname = forwardedHostname(request);
  if (!hostname) return new Response("Invalid preview host", { status: 400 });
  const destination = originalUrl(request, hostname);
  if (!destination) return new Response("Invalid preview URL", { status: 400 });

  const deployment = await options.db.query.deployments.findFirst({
    columns: { id: true, kind: true },
    where: eq(deployments.hostname, hostname),
  });
  if (!deployment) return new Response("Preview not found", { status: 404 });
  // Legacy Caddy state does not carry a kind. It may ask about production once
  // during the rolling upgrade; the database remains the authority and lets it
  // through without turning a production site into an authenticated surface.
  if (deployment.kind !== "preview") {
    const response = new Response(null, { status: 204 });
    noStore(response.headers);
    return response;
  }

  const now = options.now?.() ?? Date.now();
  const queryToken = destination.searchParams.get(FORGE_PREVIEW_SHARE_QUERY);
  if (queryToken) {
    const shared = verifyPreviewShareToken(queryToken, options.secret, now);
    if (shared?.deploymentId !== deployment.id) {
      return new Response("Invalid or expired share link", { status: 403 });
    }
    destination.searchParams.delete(FORGE_PREVIEW_SHARE_QUERY);
    const maxAge =
      shared.expiresAt === 0
        ? 365 * 24 * 60 * 60
        : Math.max(0, Math.floor((shared.expiresAt - now) / 1_000));
    const response = Response.redirect(destination, 302);
    response.headers.append(
      "Set-Cookie",
      `${PREVIEW_SHARE_COOKIE}=${queryToken}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`,
    );
    noStore(response.headers);
    return response;
  }

  const shareCookie = cookie(request, PREVIEW_SHARE_COOKIE);
  const shared = shareCookie
    ? verifyPreviewShareToken(shareCookie, options.secret, now)
    : null;
  if (shared?.deploymentId === deployment.id) {
    const response = new Response(null, { status: 204 });
    noStore(response.headers);
    return response;
  }

  const session = await options.auth.api.getSession({
    headers: request.headers,
  });
  if (session) {
    const account = await options.db.query.users.findFirst({
      columns: { role: true, status: true, totpEnabled: true },
      where: eq(users.id, session.user.id),
    });
    if (
      account?.role === "superuser" &&
      account.status === "active" &&
      account.totpEnabled &&
      session.user.status === "active" &&
      session.user.twoFactorEnabled === true
    ) {
      const response = new Response(null, { status: 204 });
      noStore(response.headers);
      return response;
    }
  }

  const login = new URL(options.loginUrl);
  login.searchParams.set("returnTo", destination.toString());
  const response = Response.redirect(login, 302);
  noStore(response.headers);
  return response;
}
