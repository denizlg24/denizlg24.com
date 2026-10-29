"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { DASHBOARD_PREFIX, moduleForPath } from "@/lib/workspace/modules";
import { PAGE_ROUTE } from "@/lib/workspace/refs";
import { HOME_PAGE_ID, moduleRef, pageRef } from "@/lib/workspace/schema";
import { useWorkspaceStore } from "@/stores/workspace";

/** Feeds the command palette's "Recent" list. */
export function VisitTracker() {
  const pathname = usePathname();
  const id = useSearchParams().get("id");
  const ready = useWorkspaceStore((s) => s.ready);
  const recordVisit = useWorkspaceStore((s) => s.recordVisit);

  useEffect(() => {
    if (!ready) return;
    if (pathname === DASHBOARD_PREFIX) recordVisit(pageRef(HOME_PAGE_ID));
    else if (pathname === PAGE_ROUTE && id) recordVisit(pageRef(id));
    else {
      const module = moduleForPath(pathname);
      if (module) recordVisit(moduleRef(module.id));
    }
  }, [pathname, id, ready, recordVisit]);

  return null;
}
