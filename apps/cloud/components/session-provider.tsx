"use client";

import type { SafeUser } from "@repo/schemas/cloud";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [user, setUser] = useState<SafeUser | null>(null);

  const load = useCallback(async () => {
    try {
      const me = await api.me();
      if (me.role !== "superuser") {
        await authClient.signOut();
        router.replace("/login?reason=forbidden");
        return;
      }
      setUser(me);
    } catch (error) {
      if (isApiError(error) && error.code === "MFA_ENROLLMENT_REQUIRED") {
        router.replace("/login?enroll=1");
        return;
      }
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = useCallback(async () => {
    await authClient.signOut();
    router.replace("/login");
  }, [router]);

  if (!user) {
    return (
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
