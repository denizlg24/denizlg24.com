"use client";

import { type AdminContextValue, AdminProvider } from "@repo/admin/provider";
import { CommandPalette } from "@repo/admin/workspace/command-palette";
import {
  WorkspaceMobileSidebar,
  WorkspaceSidebar,
} from "@repo/admin/workspace/sidebar";
import { useWorkspaceStore } from "@repo/admin/workspace/store";
import { VisitTracker } from "@repo/admin/workspace/visit-tracker";
import { useIsMobile } from "@repo/ui/hooks/use-mobile";
import { type ReactNode, Suspense, useEffect, useMemo } from "react";
import { createWebAdminClient } from "@/lib/admin-client";
import { WEB_ADMIN_ROUTES } from "@/lib/admin-routes";
import { webPlatform } from "@/lib/platform-bridge";

/** The workspace sidebar beside every dashboard page; the server holds the only copy. */
export function WebWorkspaceShell({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const hydrate = useWorkspaceStore((s) => s.hydrate);
  const value = useMemo<AdminContextValue>(
    () => ({
      client: createWebAdminClient(),
      platform: webPlatform,
      routes: WEB_ADMIN_ROUTES,
    }),
    [],
  );

  useEffect(() => {
    void hydrate({ client: value.client });
  }, [hydrate, value.client]);

  return (
    <AdminProvider value={value}>
      <div className="-mt-26 flex h-dvh max-h-screen w-full overflow-hidden">
        <Suspense>
          {isMobile ? <WorkspaceMobileSidebar /> : <WorkspaceSidebar />}
          <VisitTracker />
        </Suspense>
        {children}
        <CommandPalette />
      </div>
    </AdminProvider>
  );
}
