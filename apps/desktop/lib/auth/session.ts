import {
  type DesktopAuthConfig,
  desktopAuthConfigSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import { useAuthStore } from "@/stores/auth";
import { isTauri, platformFetch } from "../platform";
import { loadKeyValueStore } from "../platform-store";
import { openExternal } from "../utils";
import { listenForRedirect } from "./loopback";
import { codeChallenge, randomToken } from "./pkce";

/**
 * The desktop's OAuth session against the web resource: authorization code +
 * PKCE as a public client, refresh token persisted on this device, access
 * token refreshed on demand. The site publishes which issuer, client and
 * audience to use (`/api/public/desktop-auth`), so nothing here is baked in.
 *
 * Module state rather than React state because `denizApi` and the admin
 * client need a token outside any component; the zustand store mirrors just
 * enough for the UI to render sign-in and sign-out.
 */

const STORE_FILENAME = "auth.json";
const SESSION_KEY = "session";
const PENDING_KEY = "denizlg24:oauth-pending";
const REFRESH_MARGIN_MS = 30_000;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const SCOPE = "openid offline_access";
const CANCELLED = "cancelled";

const BASE_URL = process.env.NEXT_PUBLIC_DESKTOP_API_BASE_URL ?? "";

const persistedSessionSchema = desktopAuthConfigSchema.extend({
  refreshToken: z.string().min(1),
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.number(),
});
type PersistedSession = z.infer<typeof persistedSessionSchema>;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().min(1).optional(),
});

const oauthErrorSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

const pendingSignInSchema = z.object({
  config: desktopAuthConfigSchema,
  verifier: z.string(),
  state: z.string(),
  redirectUri: z.string(),
});
type PendingSignIn = z.infer<typeof pendingSignInSchema>;

export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "NotSignedInError";
  }
}

class OAuthGrantError extends Error {
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

let session: PersistedSession | null = null;
let hydrating: Promise<void> | null = null;
let refreshing: Promise<string> | null = null;
let signInAbort: AbortController | null = null;

const setState = useAuthStore.setState;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function authStore() {
  return loadKeyValueStore(STORE_FILENAME, {});
}

async function persist(next: PersistedSession | null): Promise<void> {
  session = next;
  const store = await authStore();
  if (next) {
    await store.set(SESSION_KEY, next);
  } else {
    await store.delete(SESSION_KEY);
  }
}

async function discoverConfig(): Promise<DesktopAuthConfig> {
  const origin = new URL(BASE_URL).origin;
  const res = await platformFetch(`${origin}/api/public/desktop-auth`);
  if (res.status === 404) {
    throw new Error("Desktop sign-in is not configured on the server");
  }
  if (!res.ok) {
    throw new Error(`Sign-in discovery failed with HTTP ${res.status}`);
  }
  return desktopAuthConfigSchema.parse(await res.json());
}

function authorizationUrl(
  config: DesktopAuthConfig,
  input: { redirectUri: string; state: string; challenge: string },
): string {
  const url = new URL(`${config.issuer}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: input.redirectUri,
    scope: SCOPE,
    resource: config.resource,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

async function tokenRequest(
  issuer: string,
  params: Record<string, string>,
): Promise<z.infer<typeof tokenResponseSchema>> {
  const res = await platformFetch(`${issuer}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = oauthErrorSchema.safeParse(body);
    throw parsed.success
      ? new OAuthGrantError(parsed.data.error, parsed.data.error_description)
      : new OAuthGrantError(`http_${res.status}`);
  }
  return tokenResponseSchema.parse(body);
}

async function completeSignIn(
  callback: URL,
  pending: PendingSignIn,
): Promise<void> {
  const params = callback.searchParams;
  const error = params.get("error");
  if (error) {
    throw new OAuthGrantError(error, params.get("error_description") ?? "");
  }
  if (params.get("state") !== pending.state) {
    throw new Error("Authorization response did not match this sign-in");
  }
  const code = params.get("code");
  if (!code) throw new Error("Authorization response carried no code");

  const tokens = await tokenRequest(pending.config.issuer, {
    grant_type: "authorization_code",
    code,
    redirect_uri: pending.redirectUri,
    client_id: pending.config.clientId,
    code_verifier: pending.verifier,
    resource: pending.config.resource,
  });
  if (!tokens.refresh_token) {
    throw new Error("Authorization server issued no refresh token");
  }
  await persist({
    ...pending.config,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
  });
  setState({ status: "signed-in", error: null });
}

async function refresh(current: PersistedSession): Promise<string> {
  try {
    const tokens = await tokenRequest(current.issuer, {
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      client_id: current.clientId,
      resource: current.resource,
    });
    await persist({
      ...current,
      // The server rotates refresh tokens; keeping the old one past its reuse
      // grace would turn the next refresh into a sign-out.
      refreshToken: tokens.refresh_token ?? current.refreshToken,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    });
    return tokens.access_token;
  } catch (error) {
    if (error instanceof OAuthGrantError && error.terminal) {
      await persist(null);
      setState({ status: "signed-out" });
      throw new NotSignedInError();
    }
    throw error;
  }
}

/**
 * Browser-only fallback (no Tauri): the whole page is sent to the authorization
 * server and comes back to `/` with the code, so the pending sign-in has to
 * survive in sessionStorage. Inert inside the app, where `/` never carries
 * a code.
 */
async function completeBrowserRedirect(): Promise<boolean> {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("code") && !url.searchParams.has("error")) {
    return false;
  }
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  window.history.replaceState(null, "", url.pathname);
  const pending = pendingSignInSchema.safeParse(raw ? JSON.parse(raw) : null);
  if (!pending.success) return false;
  setState({ signIn: "exchanging" });
  try {
    await completeSignIn(url, pending.data);
  } catch (error) {
    setState({ status: "signed-out", error: messageOf(error) });
  } finally {
    setState({ signIn: "idle" });
  }
  return true;
}

function startBrowserRedirect(pending: PendingSignIn, challenge: string) {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  window.location.assign(
    authorizationUrl(pending.config, {
      redirectUri: pending.redirectUri,
      state: pending.state,
      challenge,
    }),
  );
}

/** Loads the persisted session once; every token read waits on it. */
export function hydrateAuth(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  hydrating ??= (async () => {
    try {
      const store = await authStore();
      const parsed = persistedSessionSchema.safeParse(
        await store.get(SESSION_KEY),
      );
      session = parsed.success ? parsed.data : null;
    } catch (error) {
      console.error("Error loading auth session:", error);
      session = null;
    }
    if (!session && !isTauri() && (await completeBrowserRedirect())) return;
    setState({ status: session ? "signed-in" : "signed-out" });
  })();
  return hydrating;
}

/**
 * A token good for at least `REFRESH_MARGIN_MS`. Pass the token a request was
 * just refused with as `rejected`: if the session has already moved past it,
 * the newer token is returned without another round trip, which is what keeps
 * two concurrent 401s from spending two refresh tokens.
 */
export async function getAccessToken(
  options: { rejected?: string } = {},
): Promise<string> {
  await hydrateAuth();
  const current = session;
  if (!current) throw new NotSignedInError();
  const stale =
    current.accessToken === options.rejected ||
    current.accessTokenExpiresAt - Date.now() <= REFRESH_MARGIN_MS;
  if (!stale) return current.accessToken;
  refreshing ??= refresh(current).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function signIn(): Promise<void> {
  if (useAuthStore.getState().signIn !== "idle") return;
  const abort = new AbortController();
  signInAbort = abort;
  const timeout = setTimeout(
    () => abort.abort(new Error("Sign-in timed out")),
    SIGN_IN_TIMEOUT_MS,
  );
  setState({ signIn: "waiting", error: null });
  try {
    const config = await discoverConfig();
    const verifier = randomToken();
    const state = randomToken();
    const challenge = await codeChallenge(verifier);

    if (!isTauri()) {
      startBrowserRedirect(
        { config, verifier, state, redirectUri: `${window.location.origin}/` },
        challenge,
      );
      return;
    }

    const listener = await listenForRedirect(abort.signal);
    await openExternal(
      authorizationUrl(config, {
        redirectUri: listener.redirectUri,
        state,
        challenge,
      }),
    );
    const callback = await listener.callback;
    setState({ signIn: "exchanging" });
    await completeSignIn(callback, {
      config,
      verifier,
      state,
      redirectUri: listener.redirectUri,
    });
  } catch (error) {
    if (abort.signal.reason !== CANCELLED) {
      const cause = abort.signal.aborted ? abort.signal.reason : error;
      setState({ error: messageOf(cause) });
    }
  } finally {
    clearTimeout(timeout);
    signInAbort = null;
    // Releases the callback listener whichever way the flow ended.
    if (!abort.signal.aborted) abort.abort(CANCELLED);
    setState({ signIn: "idle" });
  }
}

export function cancelSignIn(): void {
  signInAbort?.abort(CANCELLED);
}

/** Clears this device first; revocation is best-effort so an offline sign-out still signs out. */
export async function signOut(): Promise<void> {
  const current = session;
  await persist(null);
  setState({ status: "signed-out", error: null });
  if (!current) return;
  try {
    await platformFetch(`${current.issuer}/oauth2/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: current.refreshToken,
        token_type_hint: "refresh_token",
        client_id: current.clientId,
      }).toString(),
    });
  } catch (error) {
    console.warn("Refresh token revocation failed:", error);
  }
}
