"use client";

import type { SafeUser } from "@repo/schemas/cloud";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
  const pathname = usePathname();
  const [user, setUser] = useState<SafeUser | null>(null);
  // Read at sign-out time rather than captured in `load`'s deps, so navigating
  // between folders does not re-run the session fetch.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const load = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch (error) {
      // Enrollment is mandatory for every account, so an un-enrolled session
      // is pushed through setup rather than signed out.
      if (isApiError(error) && error.code === "MFA_ENROLLMENT_REQUIRED") {
        router.replace("/setup-mfa");
        return;
      }
      const from = pathnameRef.current;
      const next =
        from && from !== "/" ? `?next=${encodeURIComponent(from)}` : "";
      router.replace(`/login${next}`);
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
