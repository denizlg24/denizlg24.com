"use client";

import { FlowFrame } from "@repo/auth-ui/flow-frame";
import { FlowMessage } from "@repo/auth-ui/status-step";
import { ThemeToggle } from "@repo/cloud-ui/theme";
import type { SafeUser } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { api, isApiError } from "@/lib/api";
import { PageSkeleton, ShellFrame } from "./shell-frame";

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
      <FlowFrame themeToggle={<ThemeToggle />}>
        <FlowMessage
          title="This account can't manage deniz auth"
          detail="Only the owner's account can open these pages. Sign out, then sign in with it."
          action={
            <Button asChild size="lg" className="h-11 w-full text-base">
              <a href="/logout">Sign out</a>
            </Button>
          }
        />
      </FlowFrame>
    );
  }
  if (!user) {
    return (
      <ShellFrame user={null}>
        <PageSkeleton />
      </ShellFrame>
    );
  }
  return (
    <SessionContext.Provider value={user}>{children}</SessionContext.Provider>
  );
}
