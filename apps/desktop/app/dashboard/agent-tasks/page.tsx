"use client";

import {
  AgentTasksPage,
  AgentTasksSkeleton,
} from "@repo/admin/agent-tasks/agent-tasks-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function AgentTasksRoute() {
  const { value, loading } = useDesktopAdmin();
  return (
    <AdminProvider value={value}>
      {loading ? <AgentTasksSkeleton /> : <AgentTasksPage />}
    </AdminProvider>
  );
}
