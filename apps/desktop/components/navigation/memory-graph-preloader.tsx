"use client";

import { prefetchAgentMemoryGraph } from "@repo/admin/agent-memory/graph-prefetch";
import { useEffect, useMemo } from "react";
import { createDesktopAdminClient } from "@/lib/admin-client";
import { useAuthStore } from "@/stores/auth";

// Warms the agent-memory graph cache on app load so the 3D graph renders
// instantly when the page is opened.
export function MemoryGraphPreloader() {
  const signedIn = useAuthStore((state) => state.status === "signed-in");
  const client = useMemo(() => createDesktopAdminClient(), []);

  useEffect(() => {
    if (!signedIn) return;
    prefetchAgentMemoryGraph(client);
  }, [client, signedIn]);

  return null;
}
