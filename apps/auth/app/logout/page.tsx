"use client";

import { FlowFrame } from "@repo/auth-ui/flow-frame";
import { FlowMessage } from "@repo/auth-ui/status-step";
import { safeReturnTo } from "@repo/cloud-auth-client/redirect";
import { ThemeToggle } from "@repo/cloud-ui/theme";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { authClient } from "@/lib/auth-client";

function SigningOut() {
  return (
    <FlowFrame themeToggle={<ThemeToggle />}>
      <FlowMessage
        title="Signing you out"
        detail="This device is being signed out of every app."
      />
    </FlowFrame>
  );
}

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

  return <SigningOut />;
}

export default function LogoutPage() {
  return (
    <Suspense fallback={<SigningOut />}>
      <SignOut />
    </Suspense>
  );
}
