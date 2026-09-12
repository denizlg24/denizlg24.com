"use client";

import type { SafeUser } from "@repo/schemas/cloud";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { api, isApiError } from "@/lib/api";

const SessionContext = createContext<SafeUser | null>(null);

export function useSessionUser(): SafeUser {
  const user = useContext(SessionContext);
  if (!user) throw new Error("useSessionUser outside SessionGate");
  return user;
}

export function loginHref(
  returnTo: string,
  params: Record<string, string> = {},
) {
  const url = new URL("/login", window.location.origin);
  url.searchParams.set("returnTo", returnTo);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function SessionGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .me()
      .then((me) => {
        if (!active) return;
        if (me.role !== "superuser") {
          setForbidden(true);
          return;
        }
        setUser(me);
      })
      .catch((error) => {
        if (!active) return;
        const enroll =
          isApiError(error) && error.code === "MFA_ENROLLMENT_REQUIRED";
        window.location.replace(
          loginHref(window.location.href, enroll ? { enroll: "1" } : {}),
        );
      });
    return () => {
      active = false;
    };
  }, []);

  if (forbidden) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        superuser required
      </div>
    );
  }
  if (!user) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
      </div>
    );
  }
  return (
    <SessionContext.Provider value={user}>{children}</SessionContext.Provider>
  );
}
