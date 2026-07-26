"use client";

import type { OpsOverview } from "@repo/schemas/cloud";
import { useMemo } from "react";
import {
  type ChartSpec,
  MetricSection,
} from "@/app/(app)/_components/metric-section";

/** `/dev/nvme0n1p1` -> `nvme0n1p1`; the prefix is noise in a legend. */
function shortDevice(device: string): string {
  return device.replace(/^\/dev\//, "");
}

/**
 * One chart with every disk on it rather than one per disk: the point is
 * comparing fill rates against each other, and a single series per panel would
 * hide the divergence that matters for tiering.
 */
export function UsageHistory({ overview }: { overview: OpsOverview }) {
  const specs = useMemo<ChartSpec[]>(
    () => [
      {
        title: "usage over time",
        unit: "percent",
        series: overview.disks.slice(0, 5).map((disk) => ({
          name: `disk:${disk.device}.usage_percent`,
          label: shortDevice(disk.device),
        })),
      },
    ],
    [overview],
  );

  // 7d by default: capacity moves slowly, so a day of it is a flat line.
  return (
    <MetricSection
      title="history"
      specs={specs}
      columns={1}
      defaultRange="7d"
    />
  );
}
