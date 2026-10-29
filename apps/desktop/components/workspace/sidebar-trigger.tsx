"use client";

import { Button } from "@repo/ui/button";
import { useIsMobile } from "@repo/ui/hooks/use-mobile";
import { cn } from "@repo/ui/utils";
import { PanelLeft } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace";
import { useMobileSidebar } from "./mobile-sidebar";

/**
 * Sits in every page header's leading slot. Only visible while there is no
 * sidebar on screen: collapsed on desktop, or always on a narrow window
 * where the sidebar lives in a sheet.
 */
export function SidebarTrigger({ className }: { className?: string }) {
  const collapsed = useWorkspaceStore((s) => s.workspace.sidebar.collapsed);
  const toggle = useWorkspaceStore((s) => s.toggleSidebar);
  const isMobile = useIsMobile();
  const mobile = useMobileSidebar();

  if (!isMobile && !collapsed) return null;

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Show sidebar"
      className={cn("-ml-1 text-muted-foreground", className)}
      onClick={() => (isMobile ? mobile.setOpen(true) : toggle())}
    >
      <PanelLeft />
    </Button>
  );
}
