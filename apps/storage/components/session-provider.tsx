"use client";

import type { SafeUser } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
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
import { api, errorMessage, isApiError } from "@/lib/api";
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
  const [error, setError] = useState<string | null>(null);
  // Kept in a ref so `load` does not depend on the pathname — otherwise every
  // folder navigation would refetch the session. Written in an effect rather
  // than during render, which React does not guarantee under concurrent
  // rendering.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setUser(await api.me());
    } catch (caught) {
      // Enrollment is mandatory for every account, so an un-enrolled session
      // is pushed through setup rather than signed out.
      if (isApiError(caught) && caught.code === "MFA_ENROLLMENT_REQUIRED") {
        router.replace("/setup-mfa");
        return;
      }
      // Only an actual rejection should cost the session. A flaky network or a
      // 500 must not silently sign the user out and lose where they were.
      if (!isApiError(caught) || caught.status !== 401) {
        setError(errorMessage(caught));
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
    return error ? (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div>
          <p className="text-sm font-medium">Can't reach your files</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Try again
        </Button>
      </div>
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
