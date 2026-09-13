"use client";

import { AgentDock, AgentDockProvider } from "@repo/admin/agent/agent-dock";
import { type AdminContextValue, AdminProvider } from "@repo/admin/provider";
import { type ReactNode, useMemo } from "react";
import { createWebAdminClient } from "@/lib/admin-client";
import { WEB_ADMIN_ROUTES } from "@/lib/admin-routes";
import { webPlatform } from "@/lib/platform-bridge";

/** The admin agent beside every dashboard page except the LaTeX surfaces, which run their own. */
export function WebAgentDock({ children }: { children: ReactNode }) {
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
      <AgentDockProvider>
        <AgentDock hiddenUnderPaths={["/admin/dashboard/latex"]}>
          {children}
        </AgentDock>
      </AgentDockProvider>
    </AdminProvider>
  );
}
