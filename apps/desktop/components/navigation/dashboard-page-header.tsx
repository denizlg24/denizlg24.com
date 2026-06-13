"use client";

import { PageHeader } from "@repo/ui/page-header";
import type { ComponentProps } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";

// Desktop wrapper over @repo/ui's PageHeader that injects the mobile-only nav
// trigger into the leading slot. Keeps @repo/ui free of the desktop sidebar
// (which couples to user-settings) and keeps the trigger DRY across pages.
// A caller-supplied `leading` (e.g. a back button) renders after the trigger.
export function DashboardPageHeader({
  leading,
  ...props
}: ComponentProps<typeof PageHeader>) {
  return (
    <PageHeader
      {...props}
      leading={
        <>
          <SidebarTrigger className="-ml-1 size-7 md:hidden" />
          {leading}
        </>
      }
    />
  );
}
