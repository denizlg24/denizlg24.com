"use client";

import { moduleRef, pageRef } from "@repo/schemas";
import { useEffect } from "react";
import { useWorkspaceStore } from "./store";
import { useActiveLocation, useWorkspaceNav } from "./use-workspace-nav";

/** Feeds the command palette's "Recent" list. */
export function VisitTracker() {
  const { moduleForPath } = useWorkspaceNav();
  const { pathname, pageId } = useActiveLocation();
  const ready = useWorkspaceStore((s) => s.ready);
  const recordVisit = useWorkspaceStore((s) => s.recordVisit);

  useEffect(() => {
    if (!ready) return;
    if (pageId) recordVisit(pageRef(pageId));
    else {
      const module = moduleForPath(pathname);
      if (module) recordVisit(moduleRef(module.id));
    }
  }, [pathname, pageId, ready, recordVisit, moduleForPath]);

  return null;
}
