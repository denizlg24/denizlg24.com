"use client";

import { authLoginUrl, authLogoutUrl } from "@repo/cloud-auth-client/redirect";
import type { SafeUser } from "@repo/schemas/cloud";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api, isApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

interface SessionContextValue {
  user: SafeUser;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}

/**
 * Sign-in lives on the auth app. Forge still keeps its own /login, reachable
 * only by typing it: the auth app is itself a Forge deployment, and a broken
 * release of it must not lock the owner out of the one tool that can roll it
 * back — nor out of the generated forge-server host a disaster recovery
 * bootstraps from.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);

  const load = useCallback(async () => {
    try {
      const current = await api.me();
      if (current.role !== "superuser") {
        await authClient.signOut();
        window.location.replace(
          authLoginUrl(window.location.origin, { reason: "forbidden" }),
        );
        return;
      }
      setUser(current);
    } catch (error) {
      const enroll =
        isApiError(error) && error.code === "MFA_ENROLLMENT_REQUIRED";
      window.location.replace(
        authLoginUrl(window.location.href, enroll ? { enroll: "1" } : {}),
      );
    }
  }, []);

  useEffect(() => void load(), [load]);

  const signOut = useCallback(async () => {
    window.location.assign(authLogoutUrl(window.location.origin));
  }, []);

  if (!user) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
      </div>
    );
  }

  return (
    <SessionContext.Provider value={{ user, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}
