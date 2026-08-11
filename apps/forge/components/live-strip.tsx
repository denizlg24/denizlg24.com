"use client";

import { formatBytes } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Skeleton } from "@repo/ui/skeleton";
import { useCallback } from "react";
import { api } from "@/lib/api";

const WINDOW_HOURS = 6;
const STEP_SECONDS = 300;

const METRICS = [
  "requests.count",
  "requests.5xx",
  "request.duration_ms.p95",
  "cpu.usage_percent",
  "memory.bytes",
] as const;

function sum(points: readonly { value: number }[]): number {
  return points.reduce((total, point) => total + point.value, 0);
}

function latest(points: readonly { value: number }[]): number | null {
  return points.at(-1)?.value ?? null;
}

/**
 * The five numbers worth a glance on a project overview, over the last six
 * hours. Every one is already in `FORGE_PROJECT_METRICS`, so this is one
 * request rather than a new endpoint.
 *
 * Sums are of *sample* values, so a rate has to be scaled to a real count:
 * `requests.count` is requests per 30s sample, and the window holds
 * `WINDOW_HOURS * 120` of them.
 */
export function LiveStrip({ projectSlug }: { projectSlug: string }) {
  const fetchMetrics = useCallback(() => {
    const to = new Date();
    const from = new Date(to.getTime() - WINDOW_HOURS * 60 * 60 * 1_000);
    return api.forge.projectMetrics(projectSlug, {
      metrics: [...METRICS],
      from: from.toISOString(),
      to: to.toISOString(),
      step: STEP_SECONDS,
    });
  }, [projectSlug]);
  const { data, error } = usePoll(fetchMetrics, 60_000);

  if (error) return null;
  if (!data) return <Skeleton className="h-12 w-full" />;

  const series = new Map(
    data.series.map((entry) => [entry.name, entry.points]),
  );
  const requestPoints = series.get("requests.count") ?? [];
  const errorPoints = series.get("requests.5xx") ?? [];

  // Each bucket is one averaged sample standing for `STEP_SECONDS`, so the
  // count it represents is the sample rate times the buckets it covers.
  const samplesPerBucket = STEP_SECONDS / 30;
  const requests = sum(requestPoints) * samplesPerBucket;
  const errors = sum(errorPoints) * samplesPerBucket;
  const p95 = latest(series.get("request.duration_ms.p95") ?? []);
  const cpu = latest(series.get("cpu.usage_percent") ?? []);
  const memory = latest(series.get("memory.bytes") ?? []);

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b pb-4 sm:grid-cols-5">
      <Stat label={`requests ${WINDOW_HOURS}h`} value={format(requests)} />
      <Stat
        label="error rate"
        value={
          requests > 0 ? `${((errors / requests) * 100).toFixed(2)}%` : "—"
        }
      />
      <Stat label="p95" value={p95 === null ? "—" : `${Math.round(p95)}ms`} />
      <Stat label="cpu" value={cpu === null ? "—" : `${cpu.toFixed(1)}%`} />
      <Stat
        label="memory"
        value={memory === null ? "—" : formatBytes(memory)}
      />
    </dl>
  );
}

function format(value: number): string {
  if (value <= 0) return "—";
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm tabular-nums">{value}</dd>
    </div>
  );
}
