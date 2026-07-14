"use client";

import { prefetchAgentMemoryGraph } from "@repo/admin/agent-memory/graph-prefetch";
import { useEffect, useMemo } from "react";
import { useUserSettings } from "@/context/user-context";
import { createDesktopAdminClient } from "@/lib/admin-client";

// Warms the agent-memory graph cache on app load so the 3D graph renders
// instantly when the page is opened.
export function MemoryGraphPreloader() {
  const { settings, loading } = useUserSettings();
  const client = useMemo(
    () => (settings.apiKey ? createDesktopAdminClient(settings.apiKey) : null),
    [settings.apiKey],
  );

  useEffect(() => {
    if (loading || !client) return;
    prefetchAgentMemoryGraph(client);
  }, [client, loading]);

  return null;
}
