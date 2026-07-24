"use client";

import type { OpsOverview } from "@repo/schemas/cloud";
import { cn } from "@repo/ui/utils";
import { formatBytes, formatPercent } from "@/lib/format";

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
  percent,
}: {
  label: string;
  value: string;
  sub?: string;
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
    </div>
  );
}

export function OverviewTiles({ overview }: { overview: OpsOverview }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
      <Tile
        label="cpu"
        value={formatPercent(overview.cpu.usagePercent)}
        sub={`${overview.cpu.cores} cores`}
        percent={overview.cpu.usagePercent}
      />
      <Tile
        label="load"
        value={overview.cpu.load1.toFixed(2)}
        sub={`${overview.cpu.load5.toFixed(2)} · ${overview.cpu.load15.toFixed(2)}`}
      />
      <Tile
        label="memory"
        value={formatPercent(overview.memory.usagePercent)}
        sub={`${formatBytes(overview.memory.usedBytes)} / ${formatBytes(overview.memory.totalBytes)}`}
        percent={overview.memory.usagePercent}
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
