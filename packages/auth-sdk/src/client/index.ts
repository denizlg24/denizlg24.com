import { decodeJwt } from "jose";
import { AuthorizationResponseError, OAuthGrantError } from "../core/errors.js";
import { randomToken } from "../core/pkce.js";
import { createTokenClient, type FetchLike } from "../core/tokens.js";
import { type AuthStorage, memoryStorage } from "./storage.js";

export {
  AuthorizationResponseError,
  AuthUnavailableError,
  OAuthGrantError,
} from "../core/errors.js";
export { type AuthStorage, browserStorage, memoryStorage } from "./storage.js";

export interface AuthUser {
  id: string;
  tenant: string | null;
}

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out"; error?: string }
  | { status: "signed-in"; user: AuthUser };

export interface PublicClientOptions {
  issuer?: string;
  clientId: string;
  /** The API audience the tokens are for. */
  resource: string;
  /** Default redirect URI. A native app binding a random loopback port passes one per sign-in instead. */
  redirectUri?: string;
  scope?: string;
  /** Default: in memory. Use `browserStorage()` in a browser, a secure store in a native shell. */
  storage?: AuthStorage;
  /** Key prefix in storage. Default `deniz-auth`. */
  storageKey?: string;
  fetch?: FetchLike;
  /** Refresh this long before expiry. Default 60 s. */
  refreshMarginSeconds?: number;
}

export interface SignInOptions {
  redirectUri?: string;
  prompt?: string;
  loginHint?: string;
}

export interface PublicClient {
  getState(): AuthState;
  subscribe(listener: (state: AuthState) => void): () => void;
  /** Loads the stored session. Every other method awaits it, so calling it is optional. */
  ready(): Promise<AuthState>;
  /** Builds the authorization URL and remembers what the callback must match. */
  createSignIn(options?: SignInOptions): Promise<string>;
  /** Browser convenience: `createSignIn`, then navigate there. */
  signIn(options?: SignInOptions): Promise<void>;
  /** True when a URL carries an authorization response (`state` plus `code` or `error`). */
  isCallback(url: string | URL): boolean;
  handleCallback(url: string | URL): Promise<AuthUser>;
  /**
   * A current access token, refreshed when it is about to expire; null when
   * signed out. A refused refresh signs out; an unreachable issuer throws
   * `AuthUnavailableError` and keeps the session.
   */
  getAccessToken(): Promise<string | null>;
  /** `fetch` with `Authorization: Bearer` set from `getAccessToken()`. */
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  signOut(): Promise<void>;
}

interface StoredSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

interface PendingSignIn {
  state: string;
  verifier: string;
  redirectUri: string;
}

function userFrom(accessToken: string): AuthUser | null {
  try {
    const claims = decodeJwt(accessToken);
    if (typeof claims.sub !== "string") return null;
    return {
      id: claims.sub,
      tenant: typeof claims.tenant === "string" ? claims.tenant : null,
    };
  } catch {
    return null;
  }
}

function parseJson<T>(
  raw: string | null,
  valid: (value: unknown) => value is T,
): T | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.accessToken === "string" &&
    typeof record.expiresAt === "number" &&
    (record.refreshToken === undefined ||
      typeof record.refreshToken === "string")
  );
}

function isPendingSignIn(value: unknown): value is PendingSignIn {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.state === "string" &&
    typeof record.verifier === "string" &&
    typeof record.redirectUri === "string"
  );
}

export function createPublicClient(options: PublicClientOptions): PublicClient {
  const tokens = createTokenClient({
    issuer: options.issuer,
    clientId: options.clientId,
    resource: options.resource,
    fetch: options.fetch,
  });
  const storage = options.storage ?? memoryStorage();
  const sessionKey = `${options.storageKey ?? "deniz-auth"}:session`;
  const pendingKey = `${options.storageKey ?? "deniz-auth"}:pending`;
  const marginMs = (options.refreshMarginSeconds ?? 60) * 1000;

  let state: AuthState = { status: "loading" };
  let session: StoredSession | null = null;
  let hydrating: Promise<AuthState> | null = null;
  let refreshing: Promise<string | null> | null = null;
  const listeners = new Set<(state: AuthState) => void>();

  function publish(next: AuthState) {
    state = next;
    for (const listener of listeners) listener(next);
  }

  async function persist(next: StoredSession | null, error?: string) {
    session = next;
    if (next) {
      await storage.set(sessionKey, JSON.stringify(next));
      const user = userFrom(next.accessToken);
      publish(user ? { status: "signed-in", user } : { status: "signed-out" });
    } else {
      await storage.remove(sessionKey);
      publish(
        error ? { status: "signed-out", error } : { status: "signed-out" },
      );
    }
  }

  function ready(): Promise<AuthState> {
    hydrating ??= (async () => {
      session = parseJson(await storage.get(sessionKey), isStoredSession);
      const user = session ? userFrom(session.accessToken) : null;
      publish(user ? { status: "signed-in", user } : { status: "signed-out" });
      return state;
    })();
    return hydrating;
  }

  async function createSignIn(signIn: SignInOptions = {}): Promise<string> {
    const redirectUri = signIn.redirectUri ?? options.redirectUri;
    if (!redirectUri) throw new Error("deniz auth: a redirectUri is required");
    const pending: PendingSignIn = {
      state: randomToken(),
      verifier: randomToken(),
      redirectUri,
    };
    await storage.set(pendingKey, JSON.stringify(pending));
    return tokens.authorizationUrl({
      redirectUri,
      state: pending.state,
      verifier: pending.verifier,
      scope: options.scope,
      prompt: signIn.prompt,
      loginHint: signIn.loginHint,
    });
  }

  async function refresh(current: StoredSession): Promise<string | null> {
    if (!current.refreshToken) {
      await persist(null, "session_expired");
      return null;
    }
    try {
      const next = await tokens.refresh(current.refreshToken);
      await persist({
        accessToken: next.accessToken,
        refreshToken: next.refreshToken ?? current.refreshToken,
        expiresAt: next.expiresAt,
      });
      return next.accessToken;
    } catch (error) {
      if (error instanceof OAuthGrantError && error.grantInvalid) {
        await persist(null, "session_expired");
        return null;
      }
      throw error;
    }
  }

  async function getAccessToken(): Promise<string | null> {
    await ready();
    const current = session;
    if (!current) return null;
    if (current.expiresAt - marginMs > Date.now()) return current.accessToken;
    refreshing ??= refresh(current).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    ready,
    createSignIn,

    async signIn(signIn) {
      const url = await createSignIn(signIn);
      globalThis.location.assign(url);
    },

    isCallback(url) {
      const params = new URL(url).searchParams;
      return params.has("state") && (params.has("code") || params.has("error"));
    },

    async handleCallback(url) {
      await ready();
      const params = new URL(url).searchParams;
      const pending = parseJson(await storage.get(pendingKey), isPendingSignIn);
      if (!pending) throw new AuthorizationResponseError("no_pending_sign_in");
      if (params.get("state") !== pending.state) {
        throw new AuthorizationResponseError("state_mismatch");
      }
      await storage.remove(pendingKey);
      const issuer = params.get("iss");
      if (issuer !== null && issuer.replace(/\/+$/, "") !== tokens.issuer) {
        throw new AuthorizationResponseError("issuer_mismatch");
      }
      const error = params.get("error");
      if (error) {
        throw new AuthorizationResponseError(
          error === "access_denied" ? "access_denied" : "authorization_error",
          error,
          params.get("error_description") ?? undefined,
        );
      }
      const code = params.get("code");
      if (!code) throw new AuthorizationResponseError("missing_code");
      const issued = await tokens.exchangeCode({
        code,
        verifier: pending.verifier,
        redirectUri: pending.redirectUri,
      });
      const user = userFrom(issued.accessToken);
      if (!user) throw new AuthorizationResponseError("authorization_error");
      await persist({
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        expiresAt: issued.expiresAt,
      });
      return user;
    },

    getAccessToken,

    async fetch(input, init = {}) {
      const token = await getAccessToken();
      const headers = new Headers(init.headers);
      if (token) headers.set("authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    },

    async signOut() {
      await ready();
      const current = session;
      await persist(null);
      if (current?.refreshToken) await tokens.revoke(current.refreshToken);
    },
  };
}
