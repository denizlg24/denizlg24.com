"use client";

import {
  AuthenticatorPage,
  AuthenticatorSkeleton,
} from "@repo/admin/authenticator/authenticator-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function AuthenticatorRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? <AuthenticatorSkeleton /> : <AuthenticatorPage />}
    </AdminProvider>
  );
}
