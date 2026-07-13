"use client";

import {
  AgentMemoryPage,
  AgentMemorySkeleton,
} from "@repo/admin/agent-memory/agent-memory-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function AgentMemoryRoute() {
  const { value, loading } = useDesktopAdmin();
  return (
    <AdminProvider value={value}>
      {loading ? <AgentMemorySkeleton /> : <AgentMemoryPage />}
    </AdminProvider>
  );
}
