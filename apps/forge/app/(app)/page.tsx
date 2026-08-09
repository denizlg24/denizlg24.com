"use client";

import {
  formatBytes,
  formatDurationSeconds,
  formatPercent,
} from "@repo/cloud-ui/format";
import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Skeleton } from "@repo/ui/skeleton";
import dynamic from "next/dynamic";
import { PageHeading } from "@/components/page-heading";
import { api } from "@/lib/api";

const HostCharts = dynamic(
  () => import("./_components/host-charts").then((module) => module.HostCharts),
  { ssr: false, loading: () => <Skeleton className="h-48" /> },
);

function Tile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 border-l pl-3 first:border-l-0 first:pl-0">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-lg tabular-nums">
        {value}
      </div>
      {detail ? (
        <div className="truncate text-[11px] text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

export default function OverviewPage() {
  const { data, error, unreachable, loading, reload } = usePoll(
    api.forge.overview,
    30_000,
  );
  if (!data) {
    if (unreachable)
      return <Unreachable retrying={loading} onRetry={() => void reload()} />;
    return error ? (
      <p className="text-xs text-destructive">{error}</p>
    ) : (
      <Skeleton className="h-40" />
    );
  }
  const resource = data.resource;
  const agent = data.agent;
  const memory = resource?.system.memory;
  const disk = resource?.system.disk;
  const memoryPercent =
    memory && memory.total > 0 ? (memory.used / memory.total) * 100 : null;
  const diskPercent =
    disk && disk.total > 0 ? (disk.used / disk.total) * 100 : null;
  const running =
    agent?.containers.filter((container) => container.state === "running")
      .length ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeading
        title="overview"
        detail={`sampled ${new Date(data.timestamp).toLocaleTimeString()}`}
      />
      {data.errors.resource || data.errors.agent ? (
        <div className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {[data.errors.resource, data.errors.agent]
            .filter(Boolean)
            .join(" · ")}
        </div>
      ) : null}
      <section className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
        <Tile
          label="host"
          value={resource?.status ?? "offline"}
          detail={resource?.nodeId}
        />
        <Tile
          label="uptime"
          value={resource ? formatDurationSeconds(resource.system.uptime) : "—"}
        />
        <Tile
          label="cpu"
          value={formatPercent(resource?.system.cpu_usage_percent)}
          detail={
            resource
              ? `load ${resource.system.load_avg[0].toFixed(2)}`
              : undefined
          }
        />
        <Tile
          label="memory"
          value={formatPercent(memoryPercent)}
          detail={
            memory
              ? `${formatBytes(memory.used)} / ${formatBytes(memory.total)}`
              : undefined
          }
        />
        <Tile
          label="disk"
          value={formatPercent(diskPercent)}
          detail={disk ? `${formatBytes(disk.free)} free` : undefined}
        />
        <Tile
          label="docker"
          value={agent?.health.docker.reachable ? "online" : "offline"}
          detail={agent?.health.docker.version ?? undefined}
        />
        <Tile
          label="containers"
          value={`${running}`}
          detail={`${agent?.containers.length ?? 0} total`}
        />
        <Tile
          label="images"
          value={`${agent?.images.length ?? 0}`}
          detail={formatBytes(
            agent?.images.reduce((sum, image) => sum + image.sizeBytes, 0) ?? 0,
          )}
        />
        <Tile
          label="build queue"
          value={`${agent?.health.queue.running ?? 0}/${agent?.health.queue.capacity ?? 0}`}
          detail={agent?.health.status}
        />
      </section>
      <HostCharts />
      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          services
        </h2>
        <div className="divide-y border-y">
          {(resource?.services ?? []).map((service) => (
            <div
              key={service.name}
              className="flex items-center justify-between py-2 text-xs"
            >
              <span className="font-mono">{service.name}</span>
              <span
                className={
                  service.status === "active"
                    ? "text-emerald-600"
                    : "text-destructive"
                }
              >
                {service.status}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
