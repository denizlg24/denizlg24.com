"use client";

import { formatBytes, formatPercent } from "@repo/cloud-ui/format";
import type {
  ForgeDiskIo,
  ForgeFilesystem,
  ForgeHostSnapshot,
  ForgeNetworkInterface,
  ForgeProcess,
  ForgeSensor,
} from "@repo/schemas/cloud";
import { cn } from "@repo/ui/utils";
import { useMemo } from "react";

function perSecond(bytes: number): string {
  return `${formatBytes(bytes)}/s`;
}

function rate(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(value < 10 ? 1 : 0);
}

/** A hairline section with a title and an optional right-hand note. */
export function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 border-b pb-1">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {note ? (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {note}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A utilization bar that only turns red near the top.
 *
 * A percentage is worth a colour and a number is not: 94% on a fan is nothing
 * and 94% on a filesystem is the thing you opened this page for, so the caller
 * says where the interesting end is.
 */
function Meter({
  value,
  warnAt = 75,
  criticalAt = 90,
}: {
  value: number;
  warnAt?: number;
  criticalAt?: number;
}) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          value >= criticalAt
            ? "bg-destructive"
            : value >= warnAt
              ? "bg-amber-500"
              : "bg-foreground/60",
        )}
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
    </div>
  );
}

/**
 * Every core, as a column of bars.
 *
 * The aggregate percentage hides the shape that matters on a many-core box: one
 * core pinned by a single-threaded build and thirty-one idle averages to 3%,
 * which reads identically to genuinely idle.
 */
export function CoreGrid({
  cores,
}: {
  cores: ForgeHostSnapshot["cpu"]["perCore"];
}) {
  if (cores.length === 0) return null;
  return (
    <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12 lg:grid-cols-16">
      {cores.map((core) => (
        <div
          key={core.core}
          className="flex flex-col gap-1"
          title={`core ${core.core} · ${core.usagePercent.toFixed(0)}%${
            core.mhz ? ` · ${core.mhz.toFixed(0)} MHz` : ""
          }`}
        >
          <div className="flex h-10 items-end rounded-sm bg-muted">
            <div
              className={cn(
                "w-full rounded-sm transition-[height]",
                core.usagePercent >= 90
                  ? "bg-destructive"
                  : core.usagePercent >= 60
                    ? "bg-amber-500"
                    : "bg-foreground/60",
              )}
              style={{ height: `${Math.max(core.usagePercent, 2)}%` }}
            />
          </div>
          <span className="text-center font-mono text-[9px] text-muted-foreground">
            {core.core}
          </span>
        </div>
      ))}
    </div>
  );
}

const KIND_UNITS: Record<ForgeSensor["kind"], (value: number) => string> = {
  temperature: (value) => `${value.toFixed(1)}°C`,
  fan: (value) => `${value.toFixed(0)} rpm`,
  voltage: (value) => `${value.toFixed(3)} V`,
  power: (value) => `${value.toFixed(1)} W`,
  current: (value) => `${value.toFixed(2)} A`,
  pwm: (value) => `${((value / 255) * 100).toFixed(0)}%`,
  energy: (value) => `${value.toFixed(0)} J`,
};

const KIND_ORDER: ForgeSensor["kind"][] = [
  "temperature",
  "fan",
  "power",
  "current",
  "voltage",
  "pwm",
  "energy",
];

/**
 * Every hwmon reading, grouped by the chip that published it.
 *
 * Grouped by chip rather than by kind because that is how the hardware is
 * organised and how a reading is disambiguated: `temp1` means the die on
 * `coretemp` and the motherboard socket on `nct6798`, and a flat list of
 * `temp1`s is unreadable.
 */
export function SensorGrid({ sensors }: { sensors: readonly ForgeSensor[] }) {
  const chips = useMemo(() => {
    const grouped = new Map<string, ForgeSensor[]>();
    for (const sensor of sensors) {
      const bucket = grouped.get(sensor.chip);
      if (bucket) bucket.push(sensor);
      else grouped.set(sensor.chip, [sensor]);
    }
    return [...grouped.entries()].map(([chip, readings]) => ({
      chip,
      readings: [...readings].sort(
        (a, b) =>
          KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
          a.key.localeCompare(b.key),
      ),
    }));
  }, [sensors]);

  if (chips.length === 0) {
    // Not an error state. hwmon reports whichever chips have a kernel module
    // loaded, and a box where none is loaded genuinely has nothing to show.
    return <p className="text-xs text-muted-foreground">—</p>;
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {chips.map((chip) => (
        <div key={chip.chip} className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] text-muted-foreground">
            {chip.chip}
          </span>
          <div className="flex flex-col">
            {chip.readings.map((sensor) => {
              const ceiling = sensor.critical ?? sensor.max;
              const hot =
                sensor.kind === "temperature" &&
                ceiling !== null &&
                sensor.value >= ceiling * 0.9;
              return (
                <div
                  key={sensor.key}
                  className="flex items-baseline justify-between gap-3 border-b py-0.5 text-[11px] last:border-b-0"
                >
                  <span className="min-w-0 truncate" title={sensor.label}>
                    {sensor.label}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-mono tabular-nums",
                      hot ? "text-destructive" : undefined,
                    )}
                    title={ceiling !== null ? `limit ${ceiling}` : undefined}
                  >
                    {KIND_UNITS[sensor.kind](sensor.value)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DiskTable({
  disks,
  filesystems,
}: {
  disks: readonly ForgeDiskIo[];
  filesystems: readonly ForgeFilesystem[];
}) {
  if (disks.length === 0 && filesystems.length === 0) {
    return <p className="text-xs text-muted-foreground">—</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {filesystems.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {filesystems.map((filesystem) => (
            <div key={filesystem.mount} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-[11px]">
                <span className="min-w-0 truncate font-mono">
                  {filesystem.mount}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatBytes(filesystem.usedBytes)} /{" "}
                  {formatBytes(filesystem.totalBytes)} ·{" "}
                  {formatPercent(filesystem.usagePercent)}
                </span>
              </div>
              <Meter value={filesystem.usagePercent} />
            </div>
          ))}
        </div>
      ) : null}

      {disks.length > 0 ? (
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-1 pr-2 font-normal">device</th>
              <th className="py-1 pr-2 text-right font-normal">read</th>
              <th className="py-1 pr-2 text-right font-normal">write</th>
              <th className="py-1 pr-2 text-right font-normal">iops</th>
              <th className="py-1 pr-2 text-right font-normal">queue</th>
              <th className="py-1 text-right font-normal">util</th>
            </tr>
          </thead>
          <tbody>
            {disks.map((disk) => (
              <tr key={disk.device} className="border-b last:border-b-0">
                <td className="py-1 pr-2 font-mono">{disk.device}</td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums">
                  {perSecond(disk.readBytesPerSecond)}
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums">
                  {perSecond(disk.writeBytesPerSecond)}
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums">
                  {rate(disk.readsPerSecond + disk.writesPerSecond)}
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums">
                  {disk.queueLength.toFixed(2)}
                </td>
                <td
                  className={cn(
                    "py-1 text-right font-mono tabular-nums",
                    disk.utilizationPercent >= 90
                      ? "text-destructive"
                      : undefined,
                  )}
                >
                  {formatPercent(disk.utilizationPercent)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

export function NetworkTable({
  interfaces,
}: {
  interfaces: readonly ForgeNetworkInterface[];
}) {
  if (interfaces.length === 0) {
    return <p className="text-xs text-muted-foreground">—</p>;
  }
  return (
    <table className="w-full text-left text-[11px]">
      <thead>
        <tr className="border-b text-muted-foreground">
          <th className="py-1 pr-2 font-normal">interface</th>
          <th className="py-1 pr-2 text-right font-normal">in</th>
          <th className="py-1 pr-2 text-right font-normal">out</th>
          <th className="py-1 pr-2 text-right font-normal">pps</th>
          <th className="py-1 pr-2 text-right font-normal">err/drop</th>
          <th className="py-1 text-right font-normal">link</th>
        </tr>
      </thead>
      <tbody>
        {interfaces.map((nic) => {
          const faults = nic.errorsPerSecond + nic.dropsPerSecond;
          return (
            <tr key={nic.name} className="border-b last:border-b-0">
              <td className="py-1 pr-2 font-mono">{nic.name}</td>
              <td className="py-1 pr-2 text-right font-mono tabular-nums">
                {perSecond(nic.rxBytesPerSecond)}
              </td>
              <td className="py-1 pr-2 text-right font-mono tabular-nums">
                {perSecond(nic.txBytesPerSecond)}
              </td>
              <td className="py-1 pr-2 text-right font-mono tabular-nums">
                {rate(nic.rxPacketsPerSecond + nic.txPacketsPerSecond)}
              </td>
              <td
                className={cn(
                  "py-1 pr-2 text-right font-mono tabular-nums",
                  faults > 0 ? "text-amber-600 dark:text-amber-500" : undefined,
                )}
              >
                {rate(faults)}
              </td>
              <td className="py-1 text-right font-mono tabular-nums text-muted-foreground">
                {nic.speedMbit === null ? "—" : `${nic.speedMbit}M`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * PSI, rendered as three bars rather than nine numbers.
 *
 * `some` is any task stalled and `full` is every task stalled. The second is the
 * one that means the box is not making progress, so it gets the emphasis.
 */
export function PressurePanel({
  pressure,
}: {
  pressure: NonNullable<ForgeHostSnapshot["pressure"]>;
}) {
  const rows = (
    [
      ["cpu", pressure.cpu],
      ["memory", pressure.memory],
      ["io", pressure.io],
    ] as const
  ).filter(([, reading]) => reading !== null);

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">—</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {rows.map(([name, reading]) => (
        <div key={name} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-[11px]">
            <span>{name}</span>
            <span className="tabular-nums text-muted-foreground">
              some {reading?.some.avg10.toFixed(1)}%
              {reading?.full ? ` · full ${reading.full.avg10.toFixed(1)}%` : ""}
            </span>
          </div>
          <Meter value={reading?.some.avg10 ?? 0} warnAt={10} criticalAt={40} />
        </div>
      ))}
    </div>
  );
}

export function ProcessTable({
  processes,
}: {
  processes: readonly ForgeProcess[];
}) {
  if (processes.length === 0) {
    return <p className="text-xs text-muted-foreground">—</p>;
  }
  return (
    <table className="w-full text-left text-[11px]">
      <thead>
        <tr className="border-b text-muted-foreground">
          <th className="py-1 pr-2 font-normal">pid</th>
          <th className="py-1 pr-2 font-normal">command</th>
          <th className="py-1 pr-2 text-right font-normal">cpu</th>
          <th className="py-1 pr-2 text-right font-normal">rss</th>
          <th className="py-1 text-right font-normal">thr</th>
        </tr>
      </thead>
      <tbody>
        {processes.map((process) => (
          <tr key={process.pid} className="border-b last:border-b-0">
            <td className="py-1 pr-2 font-mono tabular-nums text-muted-foreground">
              {process.pid}
            </td>
            <td
              className="max-w-0 truncate py-1 pr-2 font-mono"
              title={process.command}
            >
              {process.command}
            </td>
            <td className="py-1 pr-2 text-right font-mono tabular-nums">
              {process.cpuPercent.toFixed(1)}%
            </td>
            <td className="py-1 pr-2 text-right font-mono tabular-nums">
              {formatBytes(process.residentBytes)}
            </td>
            <td className="py-1 text-right font-mono tabular-nums text-muted-foreground">
              {process.threads}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
