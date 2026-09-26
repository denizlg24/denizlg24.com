"use client";

import { HoursApp } from "@repo/admin/hours/hours-app";
import { type AdminContextValue, AdminProvider } from "@repo/admin/provider";
import { useMemo } from "react";
import { createWebAdminClient } from "@/lib/admin-client";
import { WEB_ADMIN_ROUTES } from "@/lib/admin-routes";
import { webPlatform } from "@/lib/platform-bridge";

export function HoursShell() {
  const value = useMemo<AdminContextValue>(
    () => ({
      client: createWebAdminClient(),
      platform: webPlatform,
      routes: WEB_ADMIN_ROUTES,
    }),
    [],
  );
  return (
    <AdminProvider value={value}>
      {/* The root layout reserves room for the public header, hidden here. */}
      <div className="-mt-26">
        <HoursApp standalone />
      </div>
    </AdminProvider>
  );
}
