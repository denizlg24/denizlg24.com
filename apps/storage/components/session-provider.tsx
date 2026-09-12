"use client";

import { authLoginUrl, authLogoutUrl } from "@repo/cloud-auth-client/redirect";
import { Unreachable } from "@repo/cloud-ui/unreachable";
import type { SafeUser } from "@repo/schemas/cloud";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api, errorMessage, isApiError } from "@/lib/api";

interface SessionContextValue {
  user: SafeUser;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setUser(await api.me());
    } catch (caught) {
      // Enrollment is mandatory for every account, so an un-enrolled session
      // is pushed through setup rather than signed out.
      if (isApiError(caught) && caught.code === "MFA_ENROLLMENT_REQUIRED") {
        window.location.replace(
          authLoginUrl(window.location.href, { enroll: "1" }),
        );
        return;
      }
      // Only an actual rejection should cost the session. A flaky network or a
      // 500 must not silently sign the user out and lose where they were.
      if (!isApiError(caught) || caught.status !== 401) {
        setError(errorMessage(caught));
        return;
      }
      window.location.replace(authLoginUrl(window.location.href));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = useCallback(async () => {
    window.location.assign(authLogoutUrl(window.location.origin));
  }, []);

  if (!user) {
    return error ? (
      <Unreachable detail={error} onRetry={() => void load()} />
    ) : (
      <div className="flex flex-1 items-center justify-center">
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
      </div>
    );
  }

  return (
    <SessionContext.Provider value={{ user, refresh: load, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}
