import type { JWTVerifyGetKey } from "jose";
import { AuthUnavailableError, OAuthGrantError } from "../core/errors.js";
import { randomToken } from "../core/pkce.js";
import {
  createTokenClient,
  type FetchLike,
  type TokenClient,
  type TokenSet,
} from "../core/tokens.js";
import {
  type AccessToken,
  createVerifier,
  type Verifier,
} from "../server/verifier.js";
import { readCookie, serializeCookie } from "./cookies.js";
import { openFlow, openSession, sealFlow, sealSession } from "./seal.js";

export interface DenizAuthConfig {
  issuer?: string;
  clientId: string;
  clientSecret: string;
  /** The audience this app's access tokens are minted for — usually its own origin. */
  resource: string;
  /** The app's public origin, e.g. `https://app.example.com`. Redirects are built on it, never on the request URL, which behind a proxy is the container's. */
  baseUrl: string;
  /** At least 32 characters. Seals the session cookie; rotating it signs everyone out. */
  secret: string;
  /** Where the catch-all route is mounted. Default `/auth`. */
  basePath?: string;
  scope?: string;
  /** Default `__Host-deniz-auth` on https, `deniz-auth` on http. */
  cookieName?: string;
  /** Default `/`. */
  afterSignInPath?: string;
  /** Default `/`. */
  afterSignOutPath?: string;
  /** A failed sign-in lands here with `?auth_error=<reason>`. Default `/`. */
  errorPath?: string;
  /** Refuse a sign-in the token alone does not justify (a required scope, an allow-list). */
  authorize?: (token: AccessToken) => boolean | Promise<boolean>;
  fetch?: FetchLike;
  /** For tests: verify against these keys instead of the issuer's JWKS. */
  keys?: JWTVerifyGetKey;
}

export interface DenizSession {
  user: { id: string; tenant: string | null };
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  token: AccessToken;
}

export type SessionPayload = {
  user: { id: string; tenant: string | null } | null;
  expiresAt: number | null;
};

/** What the proxy should do with this request's session cookie. */
export type RefreshOutcome =
  | { kind: "none" }
  | { kind: "clear" }
  | { kind: "refreshed"; cookie: string; maxAge: number };

const FLOW_MAX_AGE_SECONDS = 10 * 60;
/** Browsers cap cookie lifetime at 400 days; the refresh grant decides the real end. */
const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const REFRESH_MARGIN_SECONDS = 60;

export type ConfigSource = DenizAuthConfig | (() => DenizAuthConfig);

export interface Resolved {
  config: DenizAuthConfig;
  client: TokenClient;
  verifier: Verifier;
  secure: boolean;
  basePath: string;
  sessionCookie: string;
  flowCookie: string;
  redirectUri: string;
  origin: string;
}

function resolve(config: DenizAuthConfig): Resolved {
  if (!config.clientId || !config.clientSecret) {
    throw new Error("deniz auth: clientId and clientSecret are required");
  }
  if (!config.secret || config.secret.length < 32) {
    throw new Error("deniz auth: secret must be at least 32 characters");
  }
  const origin = new URL(config.baseUrl).origin;
  const secure = origin.startsWith("https:");
  const basePath = `/${(config.basePath ?? "/auth").replace(/^\/+|\/+$/g, "")}`;
  const sessionCookie =
    config.cookieName ?? (secure ? "__Host-deniz-auth" : "deniz-auth");
  if (sessionCookie.startsWith("deniz-cloud.")) {
    // Forge's edge strips this prefix before a request reaches any app.
    throw new Error("deniz auth: cookie names may not start with deniz-cloud.");
  }
  return {
    config,
    client: createTokenClient({
      issuer: config.issuer,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      resource: config.resource,
      fetch: config.fetch,
    }),
    verifier: createVerifier({
      issuer: config.issuer,
      audience: config.resource,
      keys: config.keys,
    }),
    secure,
    basePath,
    sessionCookie,
    flowCookie: `${sessionCookie}-flow`,
    redirectUri: `${origin}${basePath}/callback`,
    origin,
  };
}

export function lazyResolver(source: ConfigSource): () => Resolved {
  let resolved: Resolved | null = null;
  return () => {
    resolved ??= resolve(typeof source === "function" ? source() : source);
    return resolved;
  };
}

/** Only same-origin paths: `/x`, never `//host` or `/\host`. */
export function safePath(
  value: string | null | undefined,
  fallback: string,
): string {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return fallback;
  }
  return value;
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function sessionMaxAge(tokens: TokenSet): number {
  return tokens.refreshToken
    ? SESSION_MAX_AGE_SECONDS
    : Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1000));
}

export async function sealTokens(
  r: Resolved,
  tokens: TokenSet,
): Promise<{ cookie: string; maxAge: number }> {
  const maxAge = sessionMaxAge(tokens);
  const cookie = await sealSession(
    r.config.secret,
    {
      at: tokens.accessToken,
      rt: tokens.refreshToken,
      exp: Math.floor(tokens.expiresAt / 1000),
    },
    maxAge,
  );
  return { cookie, maxAge };
}

export async function sessionFromCookie(
  r: Resolved,
  value: string | undefined,
): Promise<DenizSession | null> {
  const sealed = await openSession(r.config.secret, value);
  if (!sealed) return null;
  const token = await r.verifier.verify(sealed.at);
  if (!token) return null;
  return {
    user: { id: token.userId, tenant: token.tenant },
    accessToken: sealed.at,
    expiresAt: sealed.exp * 1000,
    token,
  };
}

/**
 * Refresh must happen where the cookie can be rewritten on both the request
 * (so this request's handler sees the new token) and the response — the
 * proxy. A server component cannot set cookies, and refreshing there would
 * rotate the refresh token away and lose the new one.
 */
export async function refreshFromCookie(
  r: Resolved,
  value: string | undefined,
): Promise<RefreshOutcome> {
  if (!value) return { kind: "none" };
  const sealed = await openSession(r.config.secret, value);
  if (!sealed) return { kind: "clear" };
  if (sealed.exp - Date.now() / 1000 > REFRESH_MARGIN_SECONDS) {
    return { kind: "none" };
  }
  if (!sealed.rt) {
    return sealed.exp < Date.now() / 1000
      ? { kind: "clear" }
      : { kind: "none" };
  }
  try {
    const tokens = await r.client.refresh(sealed.rt);
    const { cookie, maxAge } = await sealTokens(r, {
      ...tokens,
      refreshToken: tokens.refreshToken ?? sealed.rt,
    });
    return { kind: "refreshed", cookie, maxAge };
  } catch (error) {
    // Neither outcome clears the cookie. An unreachable issuer is no reason to
    // sign anyone out, and a refused grant is not always a dead one: a second
    // instance refreshing the same token in the same instant loses the race
    // while the winner's response carries a good cookie, and clearing here
    // could land after it. A grant that is really gone costs one refused
    // refresh per request until the next sign-in replaces the cookie.
    if (
      !(error instanceof OAuthGrantError) &&
      !(error instanceof AuthUnavailableError)
    ) {
      throw error;
    }
    return { kind: "none" };
  }
}

export function loginPath(r: Resolved, returnTo?: string): string {
  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
  return `${r.basePath}/login${query}`;
}

async function login(r: Resolved, url: URL): Promise<Response> {
  const returnTo = safePath(
    url.searchParams.get("returnTo"),
    r.config.afterSignInPath ?? "/",
  );
  const state = randomToken();
  const verifier = randomToken();
  const flow = await sealFlow(
    r.config.secret,
    { state, verifier, returnTo },
    FLOW_MAX_AGE_SECONDS,
  );
  const location = await r.client.authorizationUrl({
    redirectUri: r.redirectUri,
    state,
    verifier,
    scope: r.config.scope,
    prompt: url.searchParams.get("prompt") ?? undefined,
    loginHint: url.searchParams.get("login_hint") ?? undefined,
  });
  return redirect(location, [
    serializeCookie(r.flowCookie, flow, {
      maxAge: FLOW_MAX_AGE_SECONDS,
      secure: r.secure,
    }),
  ]);
}

async function callback(
  r: Resolved,
  request: Request,
  url: URL,
): Promise<Response> {
  const clearFlow = serializeCookie(r.flowCookie, "", {
    maxAge: 0,
    secure: r.secure,
  });
  const fail = (reason: string) => {
    const target = new URL(safePath(r.config.errorPath, "/"), r.origin);
    target.searchParams.set("auth_error", reason);
    return redirect(target.toString(), [clearFlow]);
  };

  const flow = await openFlow(
    r.config.secret,
    readCookie(request.headers.get("cookie"), r.flowCookie),
  );
  const params = url.searchParams;
  if (!flow || params.get("state") !== flow.state)
    return fail("state_mismatch");
  // RFC 9207: a response that names a different issuer is a mix-up attempt.
  const issuer = params.get("iss");
  if (issuer !== null && issuer.replace(/\/+$/, "") !== r.client.issuer) {
    return fail("issuer_mismatch");
  }
  const error = params.get("error");
  if (error)
    return fail(
      error === "access_denied" ? "access_denied" : "authorization_error",
    );
  const code = params.get("code");
  if (!code) return fail("missing_code");

  let tokens: TokenSet;
  try {
    tokens = await r.client.exchangeCode({
      code,
      verifier: flow.verifier,
      redirectUri: r.redirectUri,
    });
  } catch (caught) {
    if (caught instanceof OAuthGrantError)
      return fail(caught.code ?? "token_refused");
    if (caught instanceof AuthUnavailableError) return fail("unavailable");
    throw caught;
  }
  const token = await r.verifier.verify(tokens.accessToken);
  if (!token) return fail("invalid_token");
  if (r.config.authorize && !(await r.config.authorize(token))) {
    if (tokens.refreshToken) await r.client.revoke(tokens.refreshToken);
    return fail("forbidden");
  }
  const { cookie, maxAge } = await sealTokens(r, tokens);
  return redirect(new URL(flow.returnTo, r.origin).toString(), [
    serializeCookie(r.sessionCookie, cookie, { maxAge, secure: r.secure }),
    clearFlow,
  ]);
}

async function logout(
  r: Resolved,
  request: Request,
  url: URL,
): Promise<Response> {
  const sealed = await openSession(
    r.config.secret,
    readCookie(request.headers.get("cookie"), r.sessionCookie),
  );
  if (sealed?.rt) await r.client.revoke(sealed.rt);
  const target = safePath(
    url.searchParams.get("returnTo"),
    r.config.afterSignOutPath ?? "/",
  );
  return redirect(new URL(target, r.origin).toString(), [
    serializeCookie(r.sessionCookie, "", { maxAge: 0, secure: r.secure }),
  ]);
}

async function session(r: Resolved, request: Request): Promise<Response> {
  const current = await sessionFromCookie(
    r,
    readCookie(request.headers.get("cookie"), r.sessionCookie),
  );
  const body: SessionPayload = current
    ? { user: current.user, expiresAt: current.expiresAt }
    : { user: null, expiresAt: null };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

export async function handle(r: Resolved, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.startsWith(`${r.basePath}/`)
    ? url.pathname.slice(r.basePath.length + 1).replace(/\/+$/, "")
    : "";
  switch (action) {
    case "login":
      return request.method === "GET" ? login(r, url) : methodNotAllowed();
    case "callback":
      return request.method === "GET"
        ? callback(r, request, url)
        : methodNotAllowed();
    case "logout":
      return request.method === "GET" || request.method === "POST"
        ? logout(r, request, url)
        : methodNotAllowed();
    case "session":
      return request.method === "GET"
        ? session(r, request)
        : methodNotAllowed();
    default:
      return new Response("Not found", { status: 404 });
  }
}

function methodNotAllowed(): Response {
  return new Response("Method not allowed", { status: 405 });
}
