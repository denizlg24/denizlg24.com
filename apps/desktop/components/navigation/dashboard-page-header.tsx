"use client";

import { PageHeader } from "@repo/ui/page";
import type { ComponentProps } from "react";
import { SidebarTrigger } from "@/components/workspace/sidebar-trigger";

/**
 * @repo/ui's PageHeader with the sidebar trigger in the leading slot; a
 * caller-supplied `leading` (a back button) renders after it.
 */
export function DashboardPageHeader({
  leading,
  ...props
}: ComponentProps<typeof PageHeader>) {
  return (
    <PageHeader
      {...props}
      leading={
        <>
          <SidebarTrigger />
          {leading}
        </>
      }
    />
  );
}
