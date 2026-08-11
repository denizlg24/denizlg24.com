"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import { Skeleton } from "@repo/ui/skeleton";
import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import { MetricChart } from "./metric-chart";

/**
 * Everything the project route can aggregate, in one request. Four charts off one
 * round trip beats four requests that each re-resolve the same deployment set.
 */
const METRICS = [
  "requests.count",
  "requests.2xx",
  "requests.4xx",
  "requests.5xx",
  "request.duration_ms.p50",
  "request.duration_ms.p95",
  "cpu.usage_percent",
  "memory.bytes",
  "response.bytes",
] as const;

const WINDOWS = [
  { label: "1h", hours: 1, step: 30 },
  { label: "24h", hours: 24, step: 300 },
  { label: "7d", hours: 168, step: 1_800 },
] as const;

/**
 * Request counters are stored per 30-second sample, so a per-minute reading is
 * the sample value doubled. Correct at every resolution because the rollup
 * averages samples rather than summing them — the value always means "per
 * sample", whatever bucket it ends up in.
 */
const PER_MINUTE = 2;

export function ProjectCharts({ projectSlug }: { projectSlug: string }) {
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>(WINDOWS[1]);
  const fetchMetrics = useCallback(() => {
    const to = new Date();
    const from = new Date(to.getTime() - window.hours * 60 * 60 * 1_000);
    return api.forge.projectMetrics(projectSlug, {
      metrics: [...METRICS],
      from: from.toISOString(),
      to: to.toISOString(),
      step: window.step,
    });
  }, [projectSlug, window]);
  const { data, error, loading } = usePoll(fetchMetrics, 60_000);

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {projectSlug}
        </h2>
        <div className="flex items-center gap-1">
          {WINDOWS.map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={option.label === window.label}
              onClick={() => setWindow(option)}
              className={
                option.label === window.label
                  ? "rounded-full bg-foreground px-2 py-0.5 text-[11px] text-background transition-colors"
                  : "rounded-full px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!data && !error ? (
        <div className="grid gap-8 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : null}

      {data ? (
        <div
          className={
            loading
              ? "grid gap-8 opacity-60 transition-opacity md:grid-cols-2"
              : "grid gap-8 opacity-100 transition-opacity md:grid-cols-2"
          }
        >
          <MetricChart
            title="requests / min"
            names={["requests.count"]}
            data={data.series}
            format="count"
            scale={PER_MINUTE}
            labels={{ "requests.count": "requests" }}
          />
          <MetricChart
            title="by status / min"
            names={["requests.2xx", "requests.4xx", "requests.5xx"]}
            data={data.series}
            format="count"
            scale={PER_MINUTE}
            labels={{
              "requests.2xx": "2xx",
              "requests.4xx": "4xx",
              "requests.5xx": "5xx",
            }}
          />
          <MetricChart
            title="latency"
            names={["request.duration_ms.p50", "request.duration_ms.p95"]}
            data={data.series}
            format="ms"
            labels={{
              "request.duration_ms.p50": "p50",
              "request.duration_ms.p95": "p95",
            }}
          />
          <MetricChart
            title="cpu"
            names={["cpu.usage_percent"]}
            data={data.series}
            format="percent"
            labels={{ "cpu.usage_percent": "cpu" }}
          />
          <MetricChart
            title="memory"
            names={["memory.bytes"]}
            data={data.series}
            format="bytes"
            labels={{ "memory.bytes": "rss" }}
          />
          <MetricChart
            title="response bytes / min"
            names={["response.bytes"]}
            data={data.series}
            format="bytes"
            scale={PER_MINUTE}
            labels={{ "response.bytes": "out" }}
          />
        </div>
      ) : null}
    </section>
  );
}
