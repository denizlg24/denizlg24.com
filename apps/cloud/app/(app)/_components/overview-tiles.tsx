"use client";

import { formatBytes, formatPercent } from "@repo/cloud-ui/format";
import type { OpsOverview } from "@repo/schemas/cloud";
import { cn } from "@repo/ui/utils";

function Meter({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full",
          clamped >= 90
            ? "bg-status-critical"
            : clamped >= 80
              ? "bg-status-serious"
              : "bg-foreground/70",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  detail,
  percent,
}: {
  label: string;
  value: string;
  sub?: string;
  /** A third line, for a rate that only matters when it is non-zero. */
  detail?: string;
  percent?: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums leading-none">
        {value}
      </span>
      {sub !== undefined && (
        <span className="truncate text-xs tabular-nums text-muted-foreground">
          {sub}
        </span>
      )}
      {percent !== undefined && <Meter percent={percent} />}
      {detail !== undefined && (
        <span className="truncate text-[11px] tabular-nums text-muted-foreground/80">
          {detail}
        </span>
      )}
    </div>
  );
}

/** Counts get thousands separators; a bare 1048576 is unreadable at a glance. */
function formatCount(value: number): string {
  return value.toLocaleString();
}

export function OverviewTiles({ overview }: { overview: OpsOverview }) {
  const { swap, fileDescriptors: fds, connections } = overview;
  // Run-queue depth per core: 1.0 means the machine is exactly saturated, which
  // is the reading a bare load average cannot give without knowing the host.
  const loadPerCore =
    overview.cpu.cores > 0 ? overview.cpu.load1 / overview.cpu.cores : 0;

  const swapPaging =
    swap.outBytesPerSecond !== undefined && swap.inBytesPerSecond !== undefined
      ? `${formatBytes(swap.inBytesPerSecond)}/s in · ${formatBytes(swap.outBytesPerSecond)}/s out`
      : `${formatBytes(swap.totalBytes)} total`;

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
      <Tile
        label="cpu"
        value={formatPercent(overview.cpu.usagePercent)}
        sub={`${overview.cpu.cores} cores`}
        percent={overview.cpu.usagePercent}
      />
      <Tile
        label="load"
        value={loadPerCore.toFixed(2)}
        sub={`${overview.cpu.load1.toFixed(2)} · ${overview.cpu.load5.toFixed(2)} · ${overview.cpu.load15.toFixed(2)}`}
        // 100% of the meter is one runnable task per core; beyond that the
        // meter pins and the number carries the overload.
        percent={loadPerCore * 100}
      />
      <Tile
        label="memory"
        value={formatPercent(overview.memory.usagePercent)}
        sub={`${formatBytes(overview.memory.usedBytes)} / ${formatBytes(overview.memory.totalBytes)}`}
        percent={overview.memory.usagePercent}
      />
      <Tile
        label="swap"
        value={swap.totalBytes === 0 ? "off" : formatPercent(swap.usagePercent)}
        sub={
          swap.totalBytes === 0
            ? "not configured"
            : `${formatBytes(swap.usedBytes)} / ${formatBytes(swap.totalBytes)}`
        }
        percent={swap.totalBytes === 0 ? undefined : swap.usagePercent}
        detail={swap.totalBytes === 0 ? undefined : swapPaging}
      />
      <Tile
        label="fds"
        value={
          fds.processOpen === null
            ? formatCount(fds.allocated)
            : formatCount(fds.processOpen)
        }
        sub={
          fds.processLimit === null
            ? `${formatCount(fds.allocated)} / ${formatCount(fds.max)} host`
            : `of ${formatCount(fds.processLimit)} · host ${formatPercent(fds.usagePercent)}`
        }
        percent={fds.processUsagePercent ?? fds.usagePercent}
      />
      <Tile
        label="conns"
        value={formatCount(connections.established)}
        sub={`${formatCount(connections.inbound)} in · ${formatCount(connections.outbound)} out`}
        detail={
          connections.timeWait > 0
            ? `${formatCount(connections.timeWait)} time-wait`
            : undefined
        }
      />
      <Tile
        label="temp"
        value={
          overview.cpu.temperatureCelsius === null
            ? "—"
            : `${overview.cpu.temperatureCelsius.toFixed(1)}°C`
        }
      />
      <Tile
        label="storage"
        value={formatBytes(overview.storage.totalSizeBytes)}
        sub={`${overview.storage.fileCount} files · ${overview.storage.folderCount} folders`}
      />
      <Tile
        label="containers"
        value={String(overview.containers.length)}
        sub={`${overview.containers.filter((c) => c.state === "running").length} running`}
      />
    </div>
  );
}
