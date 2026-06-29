"use client";

import { AdminProvider } from "@repo/admin/provider";
import { type ReactNode, useMemo } from "react";
import { createWebAdminClient } from "@/lib/admin-client";
import { webPlatform } from "@/lib/platform-bridge";

export function AdminFeatureShell({ children }: { children: ReactNode }) {
  const value = useMemo(
    () => ({
      client: createWebAdminClient(),
      platform: webPlatform,
    }),
    [],
  );

  return (
    <div className="-mx-3 -mt-4 -mb-6 h-[calc(100%+2.5rem)] sm:-mx-4">
      <AdminProvider value={value}>{children}</AdminProvider>
    </div>
  );
}
