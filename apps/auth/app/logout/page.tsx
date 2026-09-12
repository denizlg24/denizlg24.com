"use client";

import { safeReturnTo } from "@repo/cloud-auth-client/redirect";
import { AuthShell } from "@repo/cloud-ui/auth-shell";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { authClient } from "@/lib/auth-client";

function SignOut() {
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get("returnTo"), {
    allowLoopback: process.env.NODE_ENV !== "production",
  });

  useEffect(() => {
    let active = true;
    void authClient.signOut().finally(() => {
      if (!active) return;
      const next = new URL("/login", window.location.origin);
      if (returnTo) next.searchParams.set("returnTo", returnTo);
      window.location.replace(next.toString());
    });
    return () => {
      active = false;
    };
  }, [returnTo]);

  return (
    <AuthShell title="Signing out">
      <span className="block size-1.5 animate-pulse rounded-full bg-muted-foreground" />
    </AuthShell>
  );
}

export default function LogoutPage() {
  return (
    <Suspense fallback={null}>
      <SignOut />
    </Suspense>
  );
}
