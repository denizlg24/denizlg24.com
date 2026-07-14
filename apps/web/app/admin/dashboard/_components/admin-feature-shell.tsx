"use client";

import { prefetchAgentMemoryGraph } from "@repo/admin/agent-memory/graph-prefetch";
import { AdminProvider } from "@repo/admin/provider";
import { type ReactNode, useEffect, useMemo } from "react";
import { createWebAdminClient } from "@/lib/admin-client";
import { webPlatform } from "@/lib/platform-bridge";

export function AdminFeatureShell({ children }: { children: ReactNode }) {
  const value = useMemo(
    () => ({
      client: createWebAdminClient(),
      platform: webPlatform,
    }),
    [],
  );

  // Warm the memory-graph cache on shell mount so the graph tab is instant.
  useEffect(() => {
    prefetchAgentMemoryGraph(value.client);
  }, [value]);

  return (
    <div className="-mx-3 -mt-4 -mb-6 h-[calc(100%+2.5rem)] sm:-mx-4">
      <AdminProvider value={value}>{children}</AdminProvider>
    </div>
  );
}
