"use client";

import { AgentDock, AgentDockProvider } from "@repo/admin/agent/agent-dock";
import { AdminProvider } from "@repo/admin/provider";
import type { BackgroundAgentRun } from "@repo/schemas";
import { type ReactNode, useCallback } from "react";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";
import { useBackgroundTasksStore } from "@/stores/background-tasks";

/** The dashboard's agent: a resizable panel beside every page but home and the LaTeX workspace. */
export function DesktopAgentDock({ children }: { children: ReactNode }) {
  const { value } = useDesktopAdmin();
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

  return (
    <AdminProvider value={value}>
      <AgentDockProvider
        allowBackground
        onActiveRunChange={handleActiveRunChange}
      >
        <AgentDock
          hiddenOnPaths={["/dashboard"]}
          hiddenUnderPaths={["/dashboard/latex/project"]}
        >
          {children}
        </AgentDock>
      </AgentDockProvider>
    </AdminProvider>
  );
}
