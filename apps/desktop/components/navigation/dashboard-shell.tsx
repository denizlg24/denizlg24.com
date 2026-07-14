"use client";

import { useIsMobile } from "@repo/ui/hooks/use-mobile";
import { SidebarProvider } from "@/components/ui/sidebar";
import { CalendarPreloader } from "./calendar-preloader";
import { CommandPalette } from "./command-palette";
import { MemoryGraphPreloader } from "./memory-graph-preloader";
import { NavigationMenu } from "./navigation-menu";

// Dashboard shell: ⌘K palette is the desktop nav (unchanged). Below md: the
// NavigationMenu mounts as a Sheet reachable via the SidebarTrigger in each
// page header. It is gated on useIsMobile() because the stock shadcn Sidebar
// renders its desktop rail at md+ (hidden md:block) — which the maintainer
// does not want — so at md+ nothing mounts and the layout stays as before.
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

  return (
    <SidebarProvider className="min-h-0 flex-1 overflow-hidden">
      <CalendarPreloader />
      <MemoryGraphPreloader />
      {isMobile ? <NavigationMenu /> : null}
      <div className="min-h-0 w-full flex-1 overflow-hidden">{children}</div>
      <CommandPalette />
    </SidebarProvider>
  );
}
