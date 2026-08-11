"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import { Skeleton } from "@repo/ui/skeleton";
import { type ReactNode, useCallback, useState } from "react";
import { api } from "@/lib/api";
import { MetricChart } from "./metric-chart";

/**
 * What the container consumed, in one request. Four charts off one round trip
 * beats four requests that each re-resolve the same deployment set.
 *
 * Resource metrics only. The request series — counts, status classes, latency
 * percentiles, bytes out — describe traffic rather than the machine, and live
 * on the logs page beside the requests they summarise. Splitting them was the
 * point: one page answered "is the box healthy" and "who is hitting /checkout"
 * at once, and neither question was easy to read off it.
 */
const METRICS = [
  "cpu.usage_percent",
  "memory.bytes",
  "memory.usage_percent",
  "network.rx_bytes_per_second",
  "network.tx_bytes_per_second",
] as const;

const WINDOWS = [
  { label: "1h", hours: 1, step: 30 },
  { label: "24h", hours: 24, step: 300 },
  { label: "7d", hours: 168, step: 1_800 },
] as const;

export function ProjectCharts({
  projectSlug,
  deploymentId = null,
  selector,
}: {
  projectSlug: string;
  /**
   * One deployment's container instead of the project aggregate. The API scopes
   * it to the project too, so an id from elsewhere reads as no data rather than
   * another project's metrics.
   */
  deploymentId?: string | null;
  /** The container picker, rendered beside the window control. */
  selector?: ReactNode;
}) {
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>(WINDOWS[1]);
  const fetchMetrics = useCallback(() => {
    const to = new Date();
    const from = new Date(to.getTime() - window.hours * 60 * 60 * 1_000);
    return api.forge.projectMetrics(projectSlug, {
      metrics: [...METRICS],
      from: from.toISOString(),
      to: to.toISOString(),
      step: window.step,
      ...(deploymentId ? { deployment: deploymentId } : {}),
    });
  }, [projectSlug, window, deploymentId]);
  const { data, error, loading } = usePoll(fetchMetrics, 60_000);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {projectSlug}
        </h2>
        <div className="flex items-center gap-2">
          {selector}
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
            title="memory headroom"
            names={["memory.usage_percent"]}
            data={data.series}
            format="percent"
            labels={{ "memory.usage_percent": "of limit" }}
          />
          <MetricChart
            title="network"
            names={[
              "network.rx_bytes_per_second",
              "network.tx_bytes_per_second",
            ]}
            data={data.series}
            format="bytes"
            labels={{
              "network.rx_bytes_per_second": "in/s",
              "network.tx_bytes_per_second": "out/s",
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
