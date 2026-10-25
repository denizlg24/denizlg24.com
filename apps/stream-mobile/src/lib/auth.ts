import {
  AuthorizationResponseError,
  type AuthState,
  AuthUnavailableError,
  createPublicClient,
  type DeviceSignIn,
  type PublicClient,
} from "@denizlg24/auth/client";
import {
  type DesktopAuthConfig,
  desktopAuthConfigSchema,
} from "@repo/schemas/cloud";
import * as WebBrowser from "expo-web-browser";
import { useSyncExternalStore } from "react";
import { API_URL, REDIRECT_URI } from "./config";
import { secureStorage } from "./secure-storage";

/**
 * deniz auth through `@denizlg24/auth/client`: authorization code + PKCE in
 * the system auth session, tokens in the keychain / Keystore. The client id,
 * issuer and resource come from Stream itself (`/api/public/native-auth`), so
 * a client rotation is a server env change, never a new build. The last
 * answer is kept so a cold start offline still finds its session.
 */

export type SessionStatus = "loading" | "signed-out" | "signed-in";

export interface SessionState {
  status: SessionStatus;
  signingIn: boolean;
  error: string | null;
}

const CONFIG_KEY = "stream.auth-config";
const STORAGE_KEY = "stream-auth";

let state: SessionState = { status: "loading", signingIn: false, error: null };
let client: PublicClient | null = null;
let config: DesktopAuthConfig | null = null;
let detach: (() => void) | null = null;
let hydrating: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(patch: Partial<SessionState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function follow(next: AuthState) {
  if (next.status === "loading") return;
  setState({
    status: next.status,
    error:
      next.status === "signed-out" && next.error === "session_expired"
        ? "You've been signed out. Please sign in again."
        : next.status === "signed-in"
          ? null
          : state.error,
  });
}

function attach(next: DesktopAuthConfig): PublicClient {
  detach?.();
  config = next;
  client = createPublicClient({
    issuer: next.issuer,
    clientId: next.clientId,
    resource: next.resource,
    redirectUri: REDIRECT_URI,
    storage: secureStorage,
    storageKey: STORAGE_KEY,
  });
  detach = client.subscribe(follow);
  return client;
}

function sameConfig(a: DesktopAuthConfig | null, b: DesktopAuthConfig) {
  return (
    a !== null &&
    a.issuer === b.issuer &&
    a.clientId === b.clientId &&
    a.resource === b.resource
  );
}

async function discover(): Promise<DesktopAuthConfig> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/public/native-auth`);
  } catch {
    throw new Error(
      "We couldn't reach Stream. Check your internet connection and try again.",
    );
  }
  if (response.status === 404) {
    throw new Error(
      "Signing in isn't switched on yet. Please try again later.",
    );
  }
  if (!response.ok) {
    throw new Error("Stream isn't answering right now. Please try again soon.");
  }
  return desktopAuthConfigSchema.parse(await response.json());
}

function friendly(error: unknown): string {
  if (error instanceof AuthUnavailableError) {
    return "We couldn't reach the sign-in service. Check your connection and try again.";
  }
  if (error instanceof AuthorizationResponseError) {
    return error.reason === "access_denied"
      ? "Sign-in was cancelled."
      : error.reason === "expired"
        ? "The code expired before it was used."
        : "Something went wrong while signing in. Please try again.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong while signing in. Please try again.";
}

export const session = {
  getState: (): SessionState => state,

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  hydrate(): Promise<void> {
    hydrating ??= (async () => {
      const raw = await Promise.resolve(secureStorage.get(CONFIG_KEY)).catch(
        () => null,
      );
      const parsed = raw
        ? desktopAuthConfigSchema.safeParse(JSON.parse(raw))
        : null;
      if (!parsed?.success) {
        setState({ status: "signed-out" });
        return;
      }
      follow(await attach(parsed.data).ready());
    })().catch(() => {
      setState({ status: "signed-out" });
    });
    return hydrating;
  },

  async signIn(): Promise<void> {
    if (state.signingIn) return;
    setState({ signingIn: true, error: null });
    try {
      const fresh = await discover();
      let current = client;
      if (!current || !sameConfig(config, fresh)) {
        current = attach(fresh);
        await secureStorage.set(CONFIG_KEY, JSON.stringify(fresh));
      }
      const url = await current.createSignIn();
      // Not ephemeral: it shares the browser's cookies, so someone already
      // signed in to deniz auth there comes straight back.
      const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT_URI, {
        preferEphemeralSession: false,
      });
      if (result.type !== "success") return;
      await current.handleCallback(result.url);
    } catch (error) {
      setState({ error: friendly(error) });
    } finally {
      setState({ signingIn: false });
    }
  },

  /**
   * A TV has no browser to sign in with: it shows a code, someone approves it
   * on their phone at the verification URI, and `complete()` finishes here.
   */
  async startDeviceSignIn(): Promise<DeviceSignIn> {
    const fresh = await discover();
    let current = client;
    if (!current || !sameConfig(config, fresh)) {
      current = attach(fresh);
      await secureStorage.set(CONFIG_KEY, JSON.stringify(fresh));
    }
    try {
      return await current.startDeviceSignIn();
    } catch (error) {
      throw new Error(friendly(error));
    }
  },

  /** A message fit for the screen, for anything `startDeviceSignIn` or `complete` throws. */
  describeError: friendly,

  async signOut(): Promise<void> {
    setState({ error: null });
    if (client) await client.signOut();
    else setState({ status: "signed-out" });
  },

  /** Null when signed out; throws `AuthUnavailableError` when the issuer cannot be reached. */
  async getAccessToken(): Promise<string | null> {
    await session.hydrate();
    return client ? client.getAccessToken() : null;
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );
}
