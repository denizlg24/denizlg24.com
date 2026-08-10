"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import { Skeleton } from "@repo/ui/skeleton";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { MetricChart } from "./metric-chart";

const SERIES = [
  "forge-host:cpu.usage_percent",
  "forge-host:memory.usage_percent",
  "forge-host:disk.usage_percent",
  "forge-host:load.1",
] as const;

export function HostCharts() {
  const fetchMetrics = useCallback(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1_000);
    return api.forge.metrics({
      series: [...SERIES],
      from: from.toISOString(),
      to: to.toISOString(),
      step: 300,
    });
  }, []);
  const { data, error } = usePoll(fetchMetrics, 60_000);
  if (!data) {
    return error ? (
      <p className="text-xs text-destructive">metrics: {error}</p>
    ) : (
      <div className="grid gap-8 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        last 24 hours
      </h2>
      <div className="grid gap-8 md:grid-cols-2">
        <MetricChart
          title="utilization"
          names={SERIES.slice(0, 3)}
          data={data.series}
          format="percent"
        />
        <MetricChart
          title="load average"
          names={[SERIES[3]]}
          data={data.series}
        />
      </div>
    </section>
  );
}
