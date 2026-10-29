"use client";

import { useIsMobile } from "@repo/ui/hooks/use-mobile";
import { Sheet, SheetContent, SheetTitle } from "@repo/ui/sheet";
import { Suspense, useEffect } from "react";
import { DesktopAgentDock } from "@/components/agent/agent-dock";
import { useMobileSidebar } from "@/components/workspace/mobile-sidebar";
import {
  WorkspaceSidebar,
  WorkspaceSidebarContent,
} from "@/components/workspace/sidebar";
import { VisitTracker } from "@/components/workspace/visit-tracker";
import { useWorkspaceStore } from "@/stores/workspace";
import { CalendarPreloader } from "./calendar-preloader";
import { CommandPalette } from "./command-palette";
import { MemoryGraphPreloader } from "./memory-graph-preloader";

function MobileSidebarSheet() {
  const open = useMobileSidebar((s) => s.open);
  const setOpen = useMobileSidebar((s) => s.setOpen);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-72 gap-0 p-0 sm:max-w-72"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <WorkspaceSidebarContent onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

/**
 * Sidebar, page, agent dock. The sidebar is the workspace tree plus every
 * module; below `md` it moves into a sheet opened from each page header.
 */
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const hydrate = useWorkspaceStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <CalendarPreloader />
      <MemoryGraphPreloader />
      <Suspense>
        {isMobile ? <MobileSidebarSheet /> : <WorkspaceSidebar />}
        <VisitTracker />
      </Suspense>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <DesktopAgentDock>{children}</DesktopAgentDock>
      </div>
      <CommandPalette />
    </div>
  );
}
