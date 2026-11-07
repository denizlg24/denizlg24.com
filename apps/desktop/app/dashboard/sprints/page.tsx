"use client";

import { RunView } from "@repo/admin/sprints/run-view";
import { SprintPage } from "@repo/admin/sprints/sprint-page";
import { SprintsPage } from "@repo/admin/sprints/sprints-page";
import { AdminQueryRoute } from "@/components/admin-route";

export default function SprintsRoute() {
  return (
    <AdminQueryRoute>
      {(params) => {
        const runId = params.get("run");
        if (runId) return <RunView key={runId} runId={runId} />;
        const sprintId = params.get("id");
        if (sprintId) return <SprintPage key={sprintId} sprintId={sprintId} />;
        return <SprintsPage />;
      }}
    </AdminQueryRoute>
  );
}
