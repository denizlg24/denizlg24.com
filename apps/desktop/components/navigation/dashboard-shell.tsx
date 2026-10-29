"use client";

import { AdminProvider } from "@repo/admin/provider";
import { CommandPalette } from "@repo/admin/workspace/command-palette";
import {
  WorkspaceMobileSidebar,
  WorkspaceSidebar,
} from "@repo/admin/workspace/sidebar";
import {
  useWorkspaceStore,
  type WorkspaceLocalCopy,
} from "@repo/admin/workspace/store";
import { VisitTracker } from "@repo/admin/workspace/visit-tracker";
import { useIsMobile } from "@repo/ui/hooks/use-mobile";
import { Suspense, useEffect } from "react";
import { DesktopAgentDock } from "@/components/agent/agent-dock";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";
import { loadKeyValueStore } from "@/lib/platform-store";
import { CalendarPreloader } from "./calendar-preloader";
import { MemoryGraphPreloader } from "./memory-graph-preloader";

const STORE_FILENAME = "workspace.json";
const STORE_KEY = "workspace";

const localCopy: WorkspaceLocalCopy = {
  load: async () =>
    (await loadKeyValueStore(STORE_FILENAME, {})).get(STORE_KEY),
  save: async (workspace) =>
    (await loadKeyValueStore(STORE_FILENAME, {})).set(STORE_KEY, workspace),
};

/**
 * Sidebar, page, agent dock. The sidebar is the workspace tree plus every
 * module; below `md` it moves into a sheet opened from each page header.
 */
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const { value } = useDesktopAdmin();
  const hydrate = useWorkspaceStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate({ client: value.client, local: localCopy });
  }, [hydrate, value.client]);

  return (
    <AdminProvider value={value}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <CalendarPreloader />
        <MemoryGraphPreloader />
        <Suspense>
          {isMobile ? <WorkspaceMobileSidebar /> : <WorkspaceSidebar />}
          <VisitTracker />
        </Suspense>
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <DesktopAgentDock>{children}</DesktopAgentDock>
        </div>
        <CommandPalette />
      </div>
    </AdminProvider>
  );
}
