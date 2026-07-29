"use client";

import type { OpsOverview } from "@repo/schemas/cloud";
import { useMemo } from "react";
import { type ChartGroup, MetricSection } from "./metric-section";

/** `/dev/nvme0n1p1` -> `nvme0n1p1`; the prefix is noise in a legend. */
function shortDevice(device: string): string {
  return device.replace(/^\/dev\//, "");
}

/**
 * Four labelled blocks rather than one wall of charts, ordered so related
 * pairs land on the same row of the two-column grid. Disk usage over time
 * lives on /disks instead — it is capacity, not activity, and it belongs next
 * to the rack that shows the same numbers live.
 */
function buildGroups(overview: OpsOverview): ChartGroup[] {
  const interfaces = overview.network.slice(0, 2);

  return [
    {
      label: "host",
      specs: [
        {
          title: "cpu",
          unit: "percent",
          series: [{ name: "host:cpu.usage_percent", label: "cpu" }],
        },
        {
          title: "load per core",
          unit: "ratio",
          series: [{ name: "host:load.per_core", label: "load / core" }],
        },
        {
          title: "memory",
          unit: "percent",
          series: [{ name: "host:memory.usage_percent", label: "memory" }],
        },
        {
          title: "swap",
          unit: "percent",
          series: [{ name: "host:swap.usage_percent", label: "swap used" }],
        },
        // Paging rate, not occupancy: a full-but-idle swap file is harmless,
        // while sustained paging is what makes everything slow.
        {
          title: "swap paging",
          unit: "bytesPerSecond",
          series: [
            { name: "host:swap.in_bytes_per_second", label: "in" },
            { name: "host:swap.out_bytes_per_second", label: "out" },
          ],
        },
        {
          title: "temperature",
          unit: "celsius",
          series: [{ name: "host:cpu.temperature_celsius", label: "cpu" }],
        },
      ],
    },

    {
      label: "descriptors & sockets",
      specs: [
        {
          title: "file descriptors",
          unit: "percent",
          series: [
            { name: "host:fd.usage_percent", label: "host" },
            { name: "host:fd.process_usage_percent", label: "api process" },
          ],
        },
        {
          title: "connections",
          unit: "count",
          series: [
            { name: "host:connections.inbound", label: "inbound" },
            { name: "host:connections.outbound", label: "outbound" },
            { name: "host:connections.time_wait", label: "time-wait" },
          ],
        },
      ],
    },

    {
      label: "databases",
      specs: [
        {
          title: "db connection saturation",
          unit: "percent",
          series: [
            { name: "db:postgres.connections_percent", label: "postgres" },
            { name: "db:mongodb.connections_percent", label: "mongodb" },
          ],
        },
        {
          title: "db clients",
          unit: "count",
          series: [
            { name: "db:postgres.connections", label: "postgres" },
            { name: "db:mongodb.connections_current", label: "mongodb" },
            { name: "db:redis.connected_clients", label: "redis" },
          ],
        },
        // The other two database charts count connections; this one counts
        // work that is stuck. Connections pinned at the ceiling while the
        // queue climbs is the shape the 2026-07-28 outage had.
        {
          title: "db contention",
          unit: "count",
          series: [
            { name: "db:postgres.waiting", label: "postgres lock waits" },
            {
              name: "db:postgres.idle_in_transaction",
              label: "postgres idle in tx",
            },
            { name: "db:mongodb.queued_total", label: "mongodb queued" },
          ],
        },
        {
          title: "redis memory",
          unit: "bytes",
          series: [{ name: "db:redis.used_memory_bytes", label: "used" }],
        },
      ],
    },

    {
      label: "network & storage",
      specs: [
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
          title: "storage size",
          unit: "bytes",
          series: [{ name: "storage:total_bytes", label: "stored" }],
        },
      ],
    },
  ];
}

export function MetricCharts({ overview }: { overview: OpsOverview }) {
  // `overview` is polled, so this recomputes on every tick regardless; what
  // actually keeps the metrics request from restarting is MetricSection
  // keying its fetch on the joined series names rather than on this array.
  const groups = useMemo(() => buildGroups(overview), [overview]);
  return <MetricSection title="metrics" groups={groups} />;
}
