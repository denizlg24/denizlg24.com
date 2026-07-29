"use client";

import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Skeleton } from "@repo/ui/skeleton";
import dynamic from "next/dynamic";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { ContainersTable } from "./_components/containers-table";
import { DatabaseStrip } from "./_components/database-strip";
import { HealthStrip } from "./_components/health-strip";
import { OverviewTiles } from "./_components/overview-tiles";
import { RecentRuns } from "./_components/recent-runs";

// recharts is the largest dependency in this app and only the dashboard draws
// a chart, so it loads after the tiles rather than blocking them.
const MetricCharts = dynamic(
  () => import("./_components/metric-charts").then((m) => m.MetricCharts),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-8 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-44 w-full" />
        ))}
      </div>
    ),
  },
);

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
        {Array.from({ length: 9 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-9 w-full" />
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
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
    unreachable,
    loading,
    reload: reloadOverview,
  } = usePoll(api.ops.overview, 30_000);
  const { data: health, error: healthError } = usePoll(api.ops.health, 30_000);
  const fetchTasks = useCallback(() => api.tasks.list({ limit: 50 }), []);
  const { data: taskData, error: taskError } = usePoll(fetchTasks, 60_000);

  if (!overview) {
    if (unreachable) {
      return (
        <Unreachable onRetry={() => void reloadOverview()} retrying={loading} />
      );
    }
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
      <DatabaseStrip databases={overview.databases} />
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
