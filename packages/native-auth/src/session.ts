import {
  type DesktopAuthConfig,
  desktopAuthConfigSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";

/**
 * Sign-in for the iPhone apps: authorization code + PKCE against deniz auth,
 * the desktop's flow with ASWebAuthenticationSession in place of a loopback
 * listener. The client id comes from `/api/public/mobile-auth` on the site,
 * so a rotation is a web env change, never a reinstall.
 *
 * The persisted session is also read and refreshed by Swift (Hours' widgets
 * and App Intents call the API themselves), so its JSON keys are a contract
 * with `Session.swift`, and every refresh re-reads storage first: another
 * process may already have moved the session on.
 */

export const persistedSessionSchema = z.object({
  site: z.url(),
  issuer: z.url(),
  clientId: z.string().min(1),
  resource: z.url(),
  refreshToken: z.string().min(1),
  accessToken: z.string().min(1),
  /** Unix milliseconds. */
  accessTokenExpiresAt: z.number(),
});
export type PersistedSession = z.infer<typeof persistedSessionSchema>;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().min(1).optional(),
});

const oauthErrorSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

const SCOPE = "openid profile email offline_access";
const REFRESH_MARGIN_MS = 60_000;

export interface SessionStore {
  read(): Promise<string | null>;
  write(json: string | null): Promise<void>;
}

export interface NativeAuthPlatform {
  /** Resolves the callback URL, or null when the sheet was dismissed. */
  openAuthSession(url: string, redirectUri: string): Promise<string | null>;
  randomBytes(length: number): Uint8Array;
  sha256(input: string): Promise<Uint8Array>;
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export type AuthStatus = "loading" | "signed-in" | "signed-out";

export interface AuthState {
  status: AuthStatus;
  signingIn: boolean;
  error: string | null;
}

export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "NotSignedInError";
  }
}

export class OAuthGrantError extends Error {
  constructor(
    readonly code: string,
    description?: string,
  ) {
    super(description ? `${code}: ${description}` : code);
    this.name = "OAuthGrantError";
  }

  /** The grant itself is gone — revoked, expired, or its client disabled. */
  get terminal(): boolean {
    return this.code === "invalid_grant" || this.code === "invalid_client";
  }
}

export function base64Url(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const n =
      ((bytes[index] ?? 0) << 16) |
      ((bytes[index + 1] ?? 0) << 8) |
      (bytes[index + 2] ?? 0);
    out +=
      alphabet[(n >> 18) & 63]! +
      alphabet[(n >> 12) & 63]! +
      alphabet[(n >> 6) & 63]! +
      alphabet[n & 63]!;
  }
  const rest = bytes.length - index;
  if (rest === 1) {
    const n = (bytes[index] ?? 0) << 16;
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8);
    out +=
      alphabet[(n >> 18) & 63]! +
      alphabet[(n >> 12) & 63]! +
      alphabet[(n >> 6) & 63]!;
  }
  return out;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface NativeAuthOptions {
  /** The site whose admin API this app calls, e.g. `https://denizlg24.com`. */
  site: string;
  /** A registered private-use redirect, `com.denizlg24.hours:/oauth/callback`. */
  redirectUri: string;
  store: SessionStore;
  platform: NativeAuthPlatform;
  /** Called after the session is cleared, for app-side cleanup. */
  onSignedOut?: () => void;
}

export interface NativeAuth {
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  hydrate(): Promise<void>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** A token good for a minute; pass the one a 401 refused to force a refresh. */
  getAccessToken(options?: { rejected?: string }): Promise<string>;
  /** Sign out locally after the server refused a fresh token. */
  expire(): Promise<void>;
}

export function createNativeAuth(options: NativeAuthOptions): NativeAuth {
  const { platform, store } = options;
  let state: AuthState = { status: "loading", signingIn: false, error: null };
  let session: PersistedSession | null = null;
  let hydrating: Promise<void> | null = null;
  let refreshing: Promise<string> | null = null;
  const listeners = new Set<() => void>();

  const setState = (patch: Partial<AuthState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  async function load(): Promise<PersistedSession | null> {
    const raw = await store.read();
    if (!raw) return null;
    try {
      const parsed = persistedSessionSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async function persist(next: PersistedSession | null) {
    session = next;
    await store.write(next ? JSON.stringify(next) : null);
  }

  async function tokenRequest(issuer: string, params: Record<string, string>) {
    const response = await platform.fetch(`${issuer}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = oauthErrorSchema.safeParse(body);
      throw parsed.success
        ? new OAuthGrantError(parsed.data.error, parsed.data.error_description)
        : new OAuthGrantError(`http_${response.status}`);
    }
    return tokenResponseSchema.parse(body);
  }

  async function discover(): Promise<DesktopAuthConfig> {
    const response = await platform.fetch(
      `${options.site}/api/public/mobile-auth`,
    );
    if (response.status === 404) {
      throw new Error("Sign-in is not configured on the server");
    }
    if (!response.ok) {
      throw new Error(`Sign-in discovery failed (${response.status})`);
    }
    return desktopAuthConfigSchema.parse(await response.json());
  }

  async function clear() {
    await persist(null);
    setState({ status: "signed-out" });
    options.onSignedOut?.();
  }

  async function refresh(): Promise<string> {
    // Another process (a widget, an App Intent) may have refreshed already.
    const stored = (await load()) ?? session;
    if (!stored) throw new NotSignedInError();
    if (
      session &&
      stored.accessToken !== session.accessToken &&
      stored.accessTokenExpiresAt - Date.now() > REFRESH_MARGIN_MS
    ) {
      session = stored;
      return stored.accessToken;
    }
    try {
      const tokens = await tokenRequest(stored.issuer, {
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
        client_id: stored.clientId,
        resource: stored.resource,
      });
      const next = {
        ...stored,
        refreshToken: tokens.refresh_token ?? stored.refreshToken,
        accessToken: tokens.access_token,
        accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
      };
      await persist(next);
      return next.accessToken;
    } catch (error) {
      if (error instanceof OAuthGrantError && error.terminal) {
        // A rotating grant another process spent a moment ago reads as
        // invalid here; its replacement is in storage.
        const latest = await load();
        if (latest && latest.refreshToken !== stored.refreshToken) {
          session = latest;
          return latest.accessToken;
        }
        await clear();
        throw new NotSignedInError();
      }
      throw error;
    }
  }

  function hydrate() {
    hydrating ??= (async () => {
      session = await load().catch(() => null);
      setState({ status: session ? "signed-in" : "signed-out" });
    })();
    return hydrating;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate,
    async signIn() {
      if (state.signingIn) return;
      setState({ signingIn: true, error: null });
      try {
        const config = await discover();
        const verifier = base64Url(platform.randomBytes(32));
        const challenge = base64Url(await platform.sha256(verifier));
        const expectedState = base64Url(platform.randomBytes(16));
        const url = new URL(`${config.issuer}/oauth2/authorize`);
        url.search = new URLSearchParams({
          response_type: "code",
          client_id: config.clientId,
          redirect_uri: options.redirectUri,
          scope: SCOPE,
          resource: config.resource,
          state: expectedState,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString();
        const callback = await platform.openAuthSession(
          url.toString(),
          options.redirectUri,
        );
        if (!callback) return;
        const params = new URL(callback).searchParams;
        const error = params.get("error");
        if (error) {
          throw new OAuthGrantError(
            error,
            params.get("error_description") ?? undefined,
          );
        }
        if (params.get("state") !== expectedState) {
          throw new Error("The sign-in response did not match this request");
        }
        const code = params.get("code");
        if (!code) throw new Error("The sign-in response carried no code");
        const tokens = await tokenRequest(config.issuer, {
          grant_type: "authorization_code",
          code,
          redirect_uri: options.redirectUri,
          client_id: config.clientId,
          code_verifier: verifier,
          resource: config.resource,
        });
        if (!tokens.refresh_token) {
          throw new Error("The server issued no refresh token");
        }
        await persist({
          site: options.site,
          issuer: config.issuer,
          clientId: config.clientId,
          resource: config.resource,
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token,
          accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
        });
        setState({ status: "signed-in" });
      } catch (error) {
        setState({ error: messageOf(error) });
      } finally {
        setState({ signingIn: false });
      }
    },
    async signOut() {
      const current = session;
      await clear();
      if (!current) return;
      await platform
        .fetch(`${current.issuer}/oauth2/revoke`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: current.refreshToken,
            token_type_hint: "refresh_token",
            client_id: current.clientId,
          }).toString(),
        })
        .catch(() => undefined);
    },
    async getAccessToken({ rejected } = {}) {
      await hydrate();
      const current = session;
      if (!current) throw new NotSignedInError();
      const stale =
        current.accessToken === rejected ||
        current.accessTokenExpiresAt - Date.now() <= REFRESH_MARGIN_MS;
      if (!stale) return current.accessToken;
      refreshing ??= refresh().finally(() => {
        refreshing = null;
      });
      return refreshing;
    },
    expire: clear,
  };
}
