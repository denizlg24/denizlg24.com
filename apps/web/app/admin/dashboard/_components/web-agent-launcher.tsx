"use client";

import { AgentLauncher } from "@repo/admin/agent/agent-launcher";
import { type AdminContextValue, AdminProvider } from "@repo/admin/provider";
import { useMemo } from "react";
import { createWebAdminClient } from "@/lib/admin-client";
import { WEB_ADMIN_ROUTES } from "@/lib/admin-routes";
import { webPlatform } from "@/lib/platform-bridge";

export function WebAgentLauncher() {
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
      <AgentLauncher hiddenOnPaths={["/admin/dashboard/latex"]} />
    </AdminProvider>
  );
}
