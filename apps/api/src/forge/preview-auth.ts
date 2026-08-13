import type { Database } from "@repo/cloud-core";
import { deployments, users } from "@repo/cloud-core/db/schema";
import { FORGE_PREVIEW_SHARE_QUERY } from "@repo/schemas/cloud";
import { eq } from "drizzle-orm";

import type { CloudAuth } from "../auth/better-auth";
import { verifyPreviewShareToken } from "./preview-share";

export const PREVIEW_SHARE_COOKIE = "__Host-forge-preview-share";
export const PREVIEW_AUTH_SEEN_COOKIE = "__Host-forge-preview-auth-seen";
const DEPLOYMENT_CACHE_TTL_MS = 5_000;

type CachedDeployment = {
  deployment: { id: string; kind: "production" | "preview" } | null;
  expiresAt: number;
};

const deploymentCaches = new WeakMap<Database, Map<string, CachedDeployment>>();

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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function previewAccessPage(input: {
  destination: URL;
  kind: "authenticating" | "unauthenticated";
  loginUrl?: string;
}): Response {
  const authenticating = input.kind === "authenticating";
  const destination = escapeHtml(input.destination.toString());
  const action = authenticating
    ? `<a class="action secondary" href="${destination}">Continue</a>`
    : `<a class="action" href="${escapeHtml(input.loginUrl ?? "")}">Sign in with Forge</a>`;
  const refreshTarget = authenticating
    ? destination
    : escapeHtml(input.loginUrl ?? "");
  const refresh = `<meta http-equiv="refresh" content="${authenticating ? 1 : 2};url=${refreshTarget}">`;
  const response = new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  ${refresh}
  <title>${authenticating ? "Authenticating preview" : "Authentication required"}</title>
  <style>
    :root { color-scheme: light dark; --background:#f9f8f6; --foreground:#647560; --muted:#4f5a4a; --border:#d2dcb6; --primary:#303630; --primary-fg:#f9f8f6; --accent:#647560; font-family:Geist,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    * { box-sizing:border-box; } html,body { min-height:100%; } body { margin:0; min-height:100vh; min-height:100dvh; display:flex; flex-direction:column; background:var(--background); color:var(--foreground); -webkit-font-smoothing:antialiased; }
    header { display:flex; height:48px; flex:none; align-items:center; padding:0 24px; border-bottom:1px solid var(--border); } .brand { font-size:14px; font-weight:600; letter-spacing:-.025em; } .brand span { color:var(--muted); } .edge { margin-left:auto; color:var(--muted); font:11px "Geist Mono",ui-monospace,monospace; }
    main { display:flex; flex:1; align-items:center; justify-content:center; padding:48px 16px; } .state { width:min(100%,320px); } .status { display:flex; align-items:center; gap:9px; margin:0 0 18px; color:var(--muted); font-size:12px; }
    .spinner { width:14px; height:14px; flex:none; border:2px solid var(--border); border-top-color:var(--accent); border-radius:999px; animation:spin .75s linear infinite; } .lock { width:8px; height:8px; flex:none; border-radius:2px; background:var(--accent); }
    h1 { margin:0; font-size:14px; font-weight:600; line-height:1.4; letter-spacing:-.015em; } .message { margin:6px 0 0; color:var(--muted); font-size:12px; line-height:1.6; } .action { display:inline-flex; height:32px; align-items:center; justify-content:center; margin-top:22px; padding:0 12px; border-radius:8px; background:var(--primary); color:var(--primary-fg); font-size:13px; font-weight:500; text-decoration:none; } .secondary { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
    footer { display:flex; min-height:44px; flex:none; align-items:center; padding:0 24px; color:var(--muted); font:10px "Geist Mono",ui-monospace,monospace; } @keyframes spin { to { transform:rotate(360deg); } }
    @media (prefers-color-scheme:dark) { :root { --background:#303630; --foreground:#f9f8f6; --muted:#d2dcb6; --border:#536150; --primary:#a1bc98; --primary-fg:#303630; --accent:#a1bc98; } } @media (prefers-reduced-motion:reduce) { .spinner { animation:none; } } @media (max-width:520px) { header,footer { padding-left:16px; padding-right:16px; } }
  </style>
</head>
<body>
  <header><div class="brand">deniz<span>forge</span></div><span class="edge">preview / auth</span></header>
  <main><section class="state" aria-labelledby="auth-title"><p class="status"><span class="${authenticating ? "spinner" : "lock"}" aria-hidden="true"></span>${authenticating ? "Authenticating" : "Private preview"}</p><h1 id="auth-title">${authenticating ? "Checking preview access…" : "Authentication required."}</h1><p class="message">${authenticating ? "Securely connecting you to this deployment." : "Sign in with an active Forge superuser account to open this preview."}</p>${action}</section></main>
  <footer>served by denizforge</footer>
</body>
</html>`,
    { status: 401 },
  );
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  response.headers.set("Content-Type", "text/html; charset=utf-8");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  noStore(response.headers);
  return response;
}

async function deploymentForHostname(
  options: PreviewAuthorizationOptions,
  hostname: string,
  now: number,
) {
  let cache = deploymentCaches.get(options.db);
  if (!cache) {
    cache = new Map();
    deploymentCaches.set(options.db, cache);
  }
  const cached = cache.get(hostname);
  if (cached && cached.expiresAt > now) return cached.deployment;
  const deployment = await options.db.query.deployments.findFirst({
    columns: { id: true, kind: true },
    where: eq(deployments.hostname, hostname),
  });
  const value = deployment
    ? { id: deployment.id, kind: deployment.kind }
    : null;
  cache.set(hostname, {
    deployment: value,
    expiresAt: now + DEPLOYMENT_CACHE_TTL_MS,
  });
  return value;
}

export function invalidatePreviewDeploymentCache(
  db: Database,
  hostname: string,
): void {
  deploymentCaches.get(db)?.delete(hostname.toLowerCase());
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

  const now = options.now?.() ?? Date.now();
  const deployment = await deploymentForHostname(options, hostname, now);
  if (!deployment) return new Response("Preview not found", { status: 404 });
  // Legacy Caddy state does not carry a kind. It may ask about production once
  // during the rolling upgrade; the database remains the authority and lets it
  // through without turning a production site into an authenticated surface.
  if (deployment.kind !== "preview") {
    const response = new Response(null, { status: 204 });
    noStore(response.headers);
    return response;
  }

  const queryToken = destination.searchParams.get(FORGE_PREVIEW_SHARE_QUERY);
  if (queryToken) {
    const shared = await verifyPreviewShareToken(
      options.db,
      queryToken,
      options.secret,
      now,
    );
    if (shared?.deploymentId !== deployment.id) {
      return new Response("Invalid or expired share link", { status: 403 });
    }
    destination.searchParams.delete(FORGE_PREVIEW_SHARE_QUERY);
    const maxAge =
      shared.expiresAt === 0
        ? 365 * 24 * 60 * 60
        : Math.max(0, Math.floor((shared.expiresAt - now) / 1_000));
    const response = previewAccessPage({
      destination,
      kind: "authenticating",
    });
    response.headers.append(
      "Set-Cookie",
      `${PREVIEW_SHARE_COOKIE}=${queryToken}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`,
    );
    response.headers.append(
      "Set-Cookie",
      `${PREVIEW_AUTH_SEEN_COOKIE}=1; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
    );
    noStore(response.headers);
    return response;
  }

  const shareCookie = cookie(request, PREVIEW_SHARE_COOKIE);
  const shared = shareCookie
    ? await verifyPreviewShareToken(
        options.db,
        shareCookie,
        options.secret,
        now,
      )
    : null;
  if (shared?.deploymentId === deployment.id) {
    const response = new Response(null, { status: 204 });
    noStore(response.headers);
    return response;
  }

  if (!cookie(request, PREVIEW_AUTH_SEEN_COOKIE)) {
    const response = previewAccessPage({
      destination,
      kind: "authenticating",
    });
    response.headers.append(
      "Set-Cookie",
      `${PREVIEW_AUTH_SEEN_COOKIE}=1; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
    );
    return response;
  }

  const session = await options.auth.api.getSession({
    headers: request.headers,
  });
  const sessionExpiresAt = session?.session.expiresAt;
  const sessionIsCurrent =
    sessionExpiresAt === undefined ||
    new Date(sessionExpiresAt).getTime() > now;
  if (session && sessionIsCurrent) {
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
  return previewAccessPage({
    destination,
    kind: "unauthenticated",
    loginUrl: login.toString(),
  });
}
