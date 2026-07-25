"use client";

import {
  formatBytes,
  formatPercent,
  formatRelative,
} from "@repo/cloud-ui/format";
import type { DiskInfo, DiskKind, OpsOverview } from "@repo/schemas/cloud";
import { Section } from "@repo/ui/section";
import { StatusDot } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { Disc3, MemoryStick, Microchip } from "lucide-react";
import { useId, useState } from "react";
import { DISK_BAY_COUNT } from "@/lib/env";

const KIND_META: Record<
  DiskKind,
  { short: string; label: string; icon: typeof Disc3 }
> = {
  ssd: { short: "SSD", label: "SSD", icon: Microchip },
  hdd: { short: "HDD", label: "HDD", icon: Disc3 },
  microsd: { short: "SD", label: "microSD", icon: MemoryStick },
};

const KIND_ORDER: DiskKind[] = ["ssd", "hdd", "microsd"];

function inferKind(device: string): DiskKind {
  const normalized = device.toLowerCase();
  if (normalized.includes("mmc") || normalized.includes("micro")) {
    return "microsd";
  }
  if (normalized.includes("nvme") || normalized.includes("ssd")) {
    return "ssd";
  }
  return "hdd";
}

function kindFor(disk: DiskInfo): DiskKind {
  return disk.kind ?? inferKind(disk.device);
}

function meterTone(percent: number, online: boolean): string {
  if (!online) return "bg-muted-foreground/40";
  if (percent >= 90) return "bg-status-critical";
  if (percent >= 80) return "bg-status-serious";
  return "bg-foreground/70";
}

function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}

function bayLabel(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function shortDevice(device: string): string {
  return device.replace(/^\/dev\//, "");
}

function BaySlat({
  disk,
  index,
  selected,
  panelId,
  onSelect,
}: {
  disk: DiskInfo;
  index: number;
  selected: boolean;
  panelId: string;
  onSelect: () => void;
}) {
  const meta = KIND_META[kindFor(disk)];
  const Icon = meta.icon;
  const percent = clampPercent(disk.usagePercent);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-controls={panelId}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex h-40 w-full flex-col text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:h-44",
        selected ? "bg-muted/60" : "bg-background hover:bg-muted/30",
      )}
    >
      <span
        className={cn(
          "flex items-center justify-between gap-1 px-1.5 py-1.5 leading-none transition-colors",
          selected ? "bg-foreground text-background" : "text-muted-foreground",
        )}
      >
        <StatusDot
          tone={disk.online ? "good" : "critical"}
          label={`${shortDevice(disk.device)} ${disk.online ? "online" : "offline"}`}
          className="size-1.5"
        />
        <span className="font-mono text-[10px] tabular-nums">
          {bayLabel(index)}
        </span>
      </span>

      <span className="relative flex min-h-0 flex-1 flex-col items-center gap-1 py-1.5">
        <span className="absolute inset-y-1 left-1.5 w-[3px] overflow-hidden rounded-full bg-foreground/10">
          <span
            className={cn(
              "absolute inset-x-0 bottom-0 rounded-full",
              meterTone(percent, disk.online),
            )}
            style={{ height: `${disk.online ? percent : 0}%` }}
          />
        </span>
        <Icon
          aria-hidden
          strokeWidth={1.5}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="font-mono text-[9px] font-medium uppercase leading-none tracking-wider text-muted-foreground">
          {meta.short}
        </span>
        <span className="min-h-0 truncate font-mono text-[10px] tracking-[0.1em] [writing-mode:vertical-rl]">
          {shortDevice(disk.device)}
        </span>
      </span>

      <span className="px-1.5 pb-1.5 text-center font-mono text-[10px] leading-none tabular-nums text-muted-foreground">
        {disk.online ? formatPercent(disk.usagePercent) : "off"}
      </span>
    </button>
  );
}

function EmptyBay({ index }: { index: number }) {
  return (
    <div className="flex h-40 flex-col bg-muted/20 sm:h-44">
      <span className="flex justify-end px-1.5 py-1.5 font-mono text-[10px] leading-none tabular-nums text-muted-foreground/50">
        {bayLabel(index)}
      </span>
      <span className="relative flex-1">
        <span
          aria-hidden
          className="absolute inset-y-3 left-1/2 border-l border-dashed border-border"
        />
        <span className="sr-only">empty</span>
      </span>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-t pt-2">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function BayDetail({
  disk,
  index,
  poolBytes,
  panelId,
}: {
  disk: DiskInfo;
  index: number;
  poolBytes: number;
  panelId: string;
}) {
  const meta = KIND_META[kindFor(disk)];
  const Icon = meta.icon;
  const percent = clampPercent(disk.usagePercent);
  const share = poolBytes > 0 ? (disk.totalBytes / poolBytes) * 100 : null;

  return (
    <div id={panelId} className="flex min-w-0 flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="flex min-w-0 items-center gap-2">
          <Icon
            aria-hidden
            strokeWidth={1.5}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="truncate font-mono text-sm font-medium">
            {disk.device}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot
            tone={disk.online ? "good" : "critical"}
            label={disk.online ? "online" : "offline"}
          />
          {disk.online ? "online" : "offline"}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold leading-none tabular-nums">
            {disk.online ? formatPercent(disk.usagePercent) : "—"}
          </span>
          <span className="text-xs text-muted-foreground">used</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              meterTone(percent, disk.online),
            )}
            style={{ width: `${disk.online ? percent : 0}%` }}
          />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <DetailStat label="bay" value={bayLabel(index)} />
        <DetailStat label="type" value={meta.label} />
        <DetailStat label="size" value={formatBytes(disk.totalBytes)} />
        <DetailStat label="used" value={formatBytes(disk.usedBytes)} />
        <DetailStat label="free" value={formatBytes(disk.availableBytes)} />
        <DetailStat label="pool share" value={formatPercent(share)} />
      </dl>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums leading-none">
        {value}
      </span>
      <span className="truncate text-xs tabular-nums text-muted-foreground">
        {sub}
      </span>
    </div>
  );
}

export function DiskRack({ overview }: { overview: OpsOverview }) {
  const disks = overview.disks;
  const panelId = useId();
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

  // Never hide a discovered disk if the configured chassis is too small.
  const rackBays = Math.max(DISK_BAY_COUNT, disks.length);
  const totalBytes = disks.reduce((sum, disk) => sum + disk.totalBytes, 0);
  const usedBytes = disks.reduce((sum, disk) => sum + disk.usedBytes, 0);
  const availableBytes = disks.reduce(
    (sum, disk) => sum + disk.availableBytes,
    0,
  );
  const onlineCount = disks.filter((disk) => disk.online).length;

  // Keying the selection by device rather than index means a poll that
  // reorders or drops a volume re-points the panel instead of silently
  // showing a different drive's numbers.
  const selectedIndex = disks.findIndex(
    (disk) => disk.device === selectedDevice,
  );
  const activeIndex = selectedIndex === -1 ? 0 : selectedIndex;
  const activeDisk = disks[activeIndex];

  const tally = KIND_ORDER.map((kind) => ({
    kind,
    count: disks.filter((disk) => kindFor(disk) === kind).length,
  })).filter((entry) => entry.count > 0);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold">
            disks
            <span className="ml-2 font-normal tabular-nums text-muted-foreground">
              {disks.length}
            </span>
          </h1>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            host storage · sampled {formatRelative(overview.timestamp)}
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot
            tone={
              disks.length > 0 && onlineCount === disks.length
                ? "good"
                : "warning"
            }
          />
          {onlineCount}/{disks.length} online
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-y py-4 sm:grid-cols-4">
        <SummaryStat
          label="capacity"
          value={formatBytes(totalBytes)}
          sub={`${disks.length} volumes`}
        />
        <SummaryStat
          label="used"
          value={formatBytes(usedBytes)}
          sub={formatPercent(
            totalBytes > 0 ? (usedBytes / totalBytes) * 100 : null,
          )}
        />
        <SummaryStat
          label="free"
          value={formatBytes(availableBytes)}
          sub={formatPercent(
            totalBytes > 0 ? (availableBytes / totalBytes) * 100 : null,
          )}
        />
        <SummaryStat
          label="bays"
          value={`${disks.length}/${rackBays}`}
          sub={`${Math.max(0, rackBays - disks.length)} empty`}
        />
      </div>

      <Section
        title="bays"
        count={rackBays}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {tally.map(({ kind, count }) => {
              const Icon = KIND_META[kind].icon;
              return (
                <span key={kind} className="flex items-center gap-1.5">
                  <Icon aria-hidden strokeWidth={1.5} className="size-3" />
                  {KIND_META[kind].label}
                  <span className="tabular-nums">{count}</span>
                </span>
              );
            })}
          </div>
        }
      >
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
          <ul className="grid w-full max-w-[19.5rem] shrink-0 grid-cols-4 gap-px border bg-border p-px sm:max-w-[22rem]">
            {Array.from({ length: rackBays }, (_, index) => {
              const disk = disks[index];
              return (
                <li key={disk?.device ?? `bay-${index}`} className="min-w-0">
                  {disk ? (
                    <BaySlat
                      disk={disk}
                      index={index}
                      panelId={panelId}
                      selected={index === activeIndex}
                      onSelect={() => setSelectedDevice(disk.device)}
                    />
                  ) : (
                    <EmptyBay index={index} />
                  )}
                </li>
              );
            })}
          </ul>

          {activeDisk && (
            <BayDetail
              disk={activeDisk}
              index={activeIndex}
              panelId={panelId}
              poolBytes={totalBytes}
            />
          )}
        </div>
      </Section>
    </div>
  );
}
