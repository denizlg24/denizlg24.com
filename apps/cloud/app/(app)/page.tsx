"use client";

import { Skeleton } from "@repo/ui/skeleton";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/use-poll";
import { ContainersTable } from "./_components/containers-table";
import { HealthStrip } from "./_components/health-strip";
import { MetricCharts } from "./_components/metric-charts";
import { OverviewTiles } from "./_components/overview-tiles";
import { RecentRuns } from "./_components/recent-runs";

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-9 w-full" />
      <div className="grid gap-8 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-44 w-full" />
        ))}
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export default function DashboardPage() {
  const {
    data: overview,
    error: overviewError,
    reload: reloadOverview,
  } = usePoll(api.ops.overview, 30_000);
  const { data: health, error: healthError } = usePoll(api.ops.health, 30_000);
  const fetchTasks = useCallback(() => api.tasks.list({ limit: 50 }), []);
  const { data: taskData, error: taskError } = usePoll(fetchTasks, 60_000);

  if (!overview) {
    return overviewError ? (
      <p className="text-xs text-destructive">{overviewError}</p>
    ) : (
      <DashboardSkeleton />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {overviewError && (
        <p className="text-xs text-destructive">{overviewError}</p>
      )}
      <OverviewTiles overview={overview} />
      {health ? (
        <HealthStrip health={health} />
      ) : (
        healthError && (
          <p className="text-xs text-destructive">health: {healthError}</p>
        )
      )}
      <MetricCharts overview={overview} />
      <ContainersTable
        containers={overview.containers}
        onChanged={() => void reloadOverview()}
      />
      {taskData ? (
        <RecentRuns tasks={taskData.tasks} runs={taskData.latestRuns} />
      ) : (
        taskError && (
          <p className="text-xs text-destructive">tasks: {taskError}</p>
        )
      )}
    </div>
  );
}
