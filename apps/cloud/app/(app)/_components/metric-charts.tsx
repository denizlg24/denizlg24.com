"use client";

import type { OpsOverview } from "@repo/schemas/cloud";
import { useMemo } from "react";
import { type ChartSpec, MetricSection } from "./metric-section";

/** `/dev/nvme0n1p1` -> `nvme0n1p1`; the prefix is noise in a legend. */
function shortDevice(device: string): string {
  return device.replace(/^\/dev\//, "");
}

/**
 * Six charts, so the two-column grid stays even. Disk usage over time lives on
 * /disks instead — it is capacity, not activity, and it belongs next to the
 * rack that shows the same numbers live.
 */
function buildSpecs(overview: OpsOverview): ChartSpec[] {
  const interfaces = overview.network.slice(0, 2);
  return [
    {
      title: "cpu",
      unit: "percent",
      series: [{ name: "host:cpu.usage_percent", label: "cpu" }],
    },
    {
      title: "memory",
      unit: "percent",
      series: [{ name: "host:memory.usage_percent", label: "memory" }],
    },
    {
      title: "temperature",
      unit: "celsius",
      series: [{ name: "host:cpu.temperature_celsius", label: "cpu" }],
    },
    {
      title: "network",
      unit: "bytesPerSecond",
      series: interfaces.flatMap((network) => [
        {
          name: `network:${network.interface}.rx_bytes_per_second`,
          label: `${network.interface} rx`,
        },
        {
          name: `network:${network.interface}.tx_bytes_per_second`,
          label: `${network.interface} tx`,
        },
      ]),
    },
    {
      title: "disk io",
      unit: "bytesPerSecond",
      series: overview.disks.slice(0, 3).flatMap((disk) => [
        {
          name: `disk:${disk.device}.read_bytes_per_second`,
          label: `${shortDevice(disk.device)} read`,
        },
        {
          name: `disk:${disk.device}.write_bytes_per_second`,
          label: `${shortDevice(disk.device)} write`,
        },
      ]),
    },
    {
      title: "disk busy",
      unit: "percent",
      series: overview.disks.slice(0, 5).map((disk) => ({
        name: `disk:${disk.device}.io_utilization_percent`,
        label: shortDevice(disk.device),
      })),
    },
  ];
}

export function MetricCharts({ overview }: { overview: OpsOverview }) {
  // `overview` is polled, so this recomputes on every tick regardless; what
  // actually keeps the metrics request from restarting is MetricSection
  // keying its fetch on the joined series names rather than on this array.
  const specs = useMemo(() => buildSpecs(overview), [overview]);
  return <MetricSection title="metrics" specs={specs} />;
}
