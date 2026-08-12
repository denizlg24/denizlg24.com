"use client";

import { AgentLauncher } from "@repo/admin/agent/agent-launcher";
import { AdminProvider } from "@repo/admin/provider";
import type { BackgroundAgentRun } from "@repo/schemas";
import { usePathname } from "next/navigation";
import { useCallback } from "react";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";
import { useBackgroundTasksStore } from "@/stores/background-tasks";

export function AgentSheet() {
  const pathname = usePathname();
  const { value, loading } = useDesktopAdmin();
  const handleActiveRunChange = useCallback(
    (run: BackgroundAgentRun | null) => {
      const store = useBackgroundTasksStore.getState();
      for (const id of Object.keys(store.tasks)) {
        if (id.startsWith("agent:") && id !== `agent:${run?.id}`) {
          store.unregister(id);
        }
      }
      if (!run) return;
      const task = {
        id: `agent:${run.id}`,
        label: "Agent",
        statusText: run.status === "queued" ? "Queued" : "Working",
        color: "bg-violet-500",
        active: true,
      };
      if (store.tasks[task.id]) store.update(task.id, task);
      else store.register(task);
    },
    [],
  );

  if (loading || !pathname.startsWith("/dashboard")) return null;
  return (
    <AdminProvider value={value}>
      <AgentLauncher
        allowBackground
        hiddenOnPaths={["/dashboard", "/dashboard/latex/project"]}
        onActiveRunChange={handleActiveRunChange}
      />
    </AdminProvider>
  );
}
