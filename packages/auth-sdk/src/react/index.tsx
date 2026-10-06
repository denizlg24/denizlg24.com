"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AuthState, AuthUser, PublicClient } from "../client/index.js";

export type { AuthState, AuthUser } from "../client/index.js";

export interface SessionValue {
  status: AuthState["status"];
  user: AuthUser | null;
  error: string | null;
  signIn(returnTo?: string): Promise<void>;
  signOut(returnTo?: string): Promise<void>;
  /** Public-client mode only; a Next app reads its token on the server. */
  getAccessToken(): Promise<string | null>;
}

const SessionContext = createContext<SessionValue | null>(null);

type ProviderProps =
  | { client: PublicClient; children: ReactNode }
  | {
      /** Where `createDenizAuth` is mounted. Default `/auth`. */
      basePath?: string;
      /** From `auth.getSession()` in a server component, to skip the first fetch. */
      initialUser?: AuthUser | null;
      children: ReactNode;
    };

function useClientSession(client: PublicClient): SessionValue {
  const [state, setState] = useState<AuthState>(() => client.getState());
  useEffect(() => {
    const unsubscribe = client.subscribe(setState);
    void client.ready();
    return unsubscribe;
  }, [client]);
  return useMemo(
    () => ({
      status: state.status,
      user: state.status === "signed-in" ? state.user : null,
      error: state.status === "signed-out" ? (state.error ?? null) : null,
      signIn: () => client.signIn(),
      signOut: () => client.signOut(),
      getAccessToken: () => client.getAccessToken(),
    }),
    [client, state],
  );
}

function useServerSession(
  basePath: string,
  initialUser: AuthUser | null | undefined,
): SessionValue {
  const [state, setState] = useState<AuthState>(() =>
    initialUser === undefined
      ? { status: "loading" }
      : initialUser
        ? { status: "signed-in", user: initialUser }
        : { status: "signed-out" },
  );
  useEffect(() => {
    if (initialUser !== undefined) return;
    let cancelled = false;
    fetch(`${basePath}/session`, { credentials: "same-origin" })
      .then((response) => response.json() as Promise<{ user: AuthUser | null }>)
      .then((body) => {
        if (cancelled) return;
        setState(
          body.user
            ? { status: "signed-in", user: body.user }
            : { status: "signed-out" },
        );
      })
      .catch(() => {
        if (!cancelled)
          setState({ status: "signed-out", error: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [basePath, initialUser]);

  const navigate = useCallback(
    async (action: "login" | "logout", returnTo?: string) => {
      const target =
        returnTo ??
        `${globalThis.location.pathname}${globalThis.location.search}`;
      globalThis.location.assign(
        `${basePath}/${action}?returnTo=${encodeURIComponent(target)}`,
      );
    },
    [basePath],
  );

  return useMemo(
    () => ({
      status: state.status,
      user: state.status === "signed-in" ? state.user : null,
      error: state.status === "signed-out" ? (state.error ?? null) : null,
      signIn: (returnTo?: string) => navigate("login", returnTo),
      signOut: (returnTo?: string) => navigate("logout", returnTo ?? "/"),
      getAccessToken: () =>
        Promise.reject(
          new Error(
            "deniz auth: read the access token on the server in a Next app",
          ),
        ),
    }),
    [navigate, state],
  );
}

function ClientProvider({
  client,
  children,
}: {
  client: PublicClient;
  children: ReactNode;
}) {
  const value = useClientSession(client);
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

function ServerProvider({
  basePath,
  initialUser,
  children,
}: {
  basePath: string;
  initialUser: AuthUser | null | undefined;
  children: ReactNode;
}) {
  const value = useServerSession(basePath, initialUser);
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function DenizAuthProvider(props: ProviderProps) {
  if ("client" in props) {
    return (
      <ClientProvider client={props.client}>{props.children}</ClientProvider>
    );
  }
  return (
    <ServerProvider
      basePath={`/${(props.basePath ?? "/auth").replace(/^\/+|\/+$/g, "")}`}
      initialUser={props.initialUser}
    >
      {props.children}
    </ServerProvider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value)
    throw new Error("useSession must be used inside <DenizAuthProvider>");
  return value;
}

export function SignedIn({ children }: { children: ReactNode }) {
  return useSession().status === "signed-in" ? children : null;
}

export function SignedOut({ children }: { children: ReactNode }) {
  return useSession().status === "signed-out" ? children : null;
}
