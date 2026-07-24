"use client";

import type { DiskInfo, DiskKind, OpsOverview } from "@repo/schemas/cloud";
import { cn } from "@repo/ui/utils";
import { HardDrive, MemoryStick, Server } from "lucide-react";
import { StatusDot } from "@/components/status-dot";
import { DISK_BAY_COUNT } from "@/lib/env";
import { formatBytes, formatPercent, formatRelative } from "@/lib/format";

const KIND_META: Record<
  DiskKind,
  { label: string; description: string; icon: typeof HardDrive }
> = {
  ssd: { label: "SSD", description: "solid state", icon: HardDrive },
  hdd: { label: "HDD", description: "rotational", icon: HardDrive },
  microsd: { label: "microSD", description: "removable", icon: MemoryStick },
};

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

function CapacityMeter({ disk }: { disk: DiskInfo }) {
  const percent = Math.max(0, Math.min(100, disk.usagePercent));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", meterTone(percent, disk.online))}
          style={{ width: `${disk.online ? percent : 0}%` }}
        />
      </div>
      <span className="w-11 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
        {disk.online ? formatPercent(disk.usagePercent) : "offline"}
      </span>
    </div>
  );
}

function DriveFace({ disk, kind }: { disk: DiskInfo; kind: DiskKind }) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center border bg-muted/60 shadow-inner",
        kind === "ssd" && "h-14 w-[5.5rem] rounded-[3px] border-foreground/20",
        kind === "hdd" &&
          "h-[4.25rem] w-[7.25rem] rounded-[5px] border-foreground/20",
        kind === "microsd" &&
          "h-[4.5rem] w-12 rounded-[3px] border-foreground/20 [clip-path:polygon(0_0,72%_0,100%_25%,100%_100%,0_100%)]",
        !disk.online && "opacity-45",
      )}
    >
      {kind === "hdd" && (
        <span className="absolute left-2 top-2 size-7 rounded-full border border-foreground/15 bg-background/30">
          <span className="absolute inset-2 rounded-full bg-foreground/20" />
        </span>
      )}
      {kind === "ssd" && (
        <span className="absolute inset-x-2 top-2 grid grid-cols-6 gap-0.5">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className="h-1 bg-foreground/20" />
          ))}
        </span>
      )}
      {kind === "microsd" && (
        <span className="absolute inset-x-2 bottom-2 grid grid-cols-2 gap-1">
          {Array.from({ length: 4 }, (_, index) => (
            <span key={index} className="h-1 bg-foreground/20" />
          ))}
        </span>
      )}
      <span
        className={cn(
          "absolute bottom-2 right-2 size-1.5 rounded-full",
          disk.online ? "bg-status-good" : "bg-status-critical",
        )}
      />
      <span className="absolute bottom-2 left-2 h-1 w-5 bg-foreground/15" />
    </div>
  );
}

function RackBay({ disk, slot }: { disk?: DiskInfo; slot: number }) {
  const kind = disk ? kindFor(disk) : null;
  const meta = kind ? KIND_META[kind] : null;
  const Icon = meta?.icon ?? Server;

  return (
    <article
      className={cn(
        "relative flex min-h-32 items-center gap-3 overflow-hidden bg-background px-4 py-3",
        disk?.online === false && "bg-muted/20",
      )}
      title={disk ? `${disk.device} · ${meta?.label}` : "empty bay"}
    >
      <span className="absolute inset-y-2 left-1 w-px bg-border" />
      <span className="absolute inset-y-2 right-1 w-px bg-border" />
      {disk ? (
        <DriveFace disk={disk} kind={kind ?? "hdd"} />
      ) : (
        <div className="flex h-14 w-[5.5rem] shrink-0 items-center justify-center rounded-sm border border-dashed border-border bg-muted/20 text-muted-foreground/40">
          <Icon className="size-5" strokeWidth={1.25} />
        </div>
      )}
      <div className="min-w-0 flex-1 self-stretch py-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-mono text-xs font-medium">
              {disk?.device ?? "empty bay"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {meta ? `${meta.label} · ${meta.description}` : "available"}
            </p>
          </div>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {String(slot).padStart(2, "0")}
          </span>
        </div>
        {disk ? (
          <div className="mt-4 flex flex-col gap-1.5">
            <CapacityMeter disk={disk} />
            <div className="flex justify-between gap-2 text-[10px] tabular-nums text-muted-foreground">
              <span>
                {disk.online ? formatBytes(disk.usedBytes) : "not mounted"}
              </span>
              <span>
                {disk.online
                  ? `${formatBytes(disk.availableBytes)} free`
                  : "check connection"}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-5 h-1 border-t border-dashed border-border" />
        )}
      </div>
    </article>
  );
}

function SummaryStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums leading-none">
        {value}
      </span>
      {sub && (
        <span className="truncate text-xs text-muted-foreground">{sub}</span>
      )}
    </div>
  );
}

export function DiskRack({ overview }: { overview: OpsOverview }) {
  const disks = overview.disks;
  // Never hide a discovered disk if the configured chassis is too small.
  const rackBays = Math.max(DISK_BAY_COUNT, disks.length);
  const totalBytes = disks.reduce((sum, disk) => sum + disk.totalBytes, 0);
  const usedBytes = disks.reduce((sum, disk) => sum + disk.usedBytes, 0);
  const availableBytes = disks.reduce(
    (sum, disk) => sum + disk.availableBytes,
    0,
  );
  const onlineCount = disks.filter((disk) => disk.online).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold">
            disks
            <span className="ml-2 font-normal text-muted-foreground">
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

      <div className="grid grid-cols-2 gap-6 border-y py-4 sm:grid-cols-4">
        <SummaryStat
          label="capacity"
          value={formatBytes(totalBytes)}
          sub={`${formatBytes(usedBytes)} used`}
        />
        <SummaryStat
          label="free"
          value={formatBytes(availableBytes)}
          sub="across mounted volumes"
        />
        <SummaryStat
          label="bays"
          value={String(rackBays)}
          sub={`${Math.max(0, rackBays - disks.length)} available`}
        />
        <SummaryStat
          label="health"
          value={`${onlineCount}/${disks.length}`}
          sub={
            onlineCount === disks.length ? "all responding" : "attention needed"
          }
        />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2">
          <h2 className="text-sm font-semibold">server backplane</h2>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {(Object.keys(KIND_META) as DiskKind[]).map((kind) => {
              const Icon = KIND_META[kind].icon;
              return (
                <span key={kind} className="flex items-center gap-1.5">
                  <Icon className="size-3" strokeWidth={1.5} />
                  {KIND_META[kind].label}
                </span>
              );
            })}
          </div>
        </div>

        <div className="overflow-hidden border border-foreground/20 bg-muted/30 p-2 shadow-sm">
          <div className="flex items-center justify-between border-b border-foreground/15 px-3 pb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            <span className="flex items-center gap-2">
              <Server className="size-3" />
              denizcloud / storage chassis
            </span>
            <span className="font-mono tabular-nums">{rackBays} bays</span>
          </div>
          <div className="mt-2 grid gap-px bg-border/80 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: rackBays }, (_, index) => (
              <RackBay
                key={disks[index]?.device ?? index}
                disk={disks[index]}
                slot={index + 1}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
