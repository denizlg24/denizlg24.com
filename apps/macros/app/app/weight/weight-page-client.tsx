"use client";

import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { format, subDays, subMonths, subYears } from "date-fns";
import { Pencil, Plus, Scale } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useWeightOverview } from "@/lib/app-cache/api";
import type {
  WeighInItem,
  WeightTrendPointItem,
} from "@/lib/weights/contracts";
import { dateToIso, isoToLocalDate } from "@/lib/weights/date-utils";
import { BigStat } from "../_components/big-stat";
import { PageHeader } from "../_components/page-header";

const RANGES = ["1W", "1M", "3M", "6M", "1Y", "All"] as const;
type Range = (typeof RANGES)[number];

export function WeightPageClient() {
  const { data, isLoading, isError, refetch } = useWeightOverview();
  const [range, setRange] = useState<Range>("1W");

  const filtered = useMemo(() => {
    if (!data) return null;
    return filterEntries(data.entries, data.trend, range, data.today);
  }, [data, range]);

  if (isLoading) {
    return (
      <div className="min-h-dvh px-5 pt-5 pb-36">
        <Skeleton className="mb-5 h-8 w-40 mx-auto" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-dvh px-5 pt-5 pb-36">
        <Button type="button" variant="outline" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-dvh px-5 pt-5 pb-36">
        <Skeleton className="mb-5 h-8 w-40 mx-auto" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const points = filtered?.points ?? [];
  const averageKg = points.length
    ? points.reduce((sum, point) => sum + point.trendWeightKg, 0) /
      points.length
    : null;
  const firstPoint = points.at(0);
  const lastPoint = points.at(-1);
  const differenceKg =
    firstPoint && lastPoint && points.length >= 2
      ? lastPoint.trendWeightKg - firstPoint.trendWeightKg
      : null;
  const rangeLabel = filtered ? buildRangeLabel(filtered, range) : "";
  const entriesByMonth = groupEntriesByMonth(data.entries);

  return (
    <div className="min-h-dvh bg-background pb-36">
      <PageHeader
        title="Weight Trend"
        backLabel="Back to dashboard"
        action={
          <Button asChild type="button" variant="ghost" size="icon">
            <Link href="/app/weigh-in?log=today" aria-label="Add weigh-in">
              <Plus className="size-6" />
            </Link>
          </Button>
        }
      />

      <section className="px-5 pt-4">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-5">
          <BigStat
            label="Average"
            value={averageKg?.toFixed(1) ?? "--"}
            suffix="kg"
            caption={rangeLabel}
          />
          <BigStat
            label="Difference"
            value={formatDifference(differenceKg)}
            suffix="kg"
          />
          <div className="flex size-14 items-center justify-center rounded-full bg-muted">
            <Scale className="size-6 text-primary" />
          </div>
        </div>

        <WeightChart points={points} />

        {points.length >= 2 ? (
          <div className="mt-1 flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-primary" />
              Trend
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full border border-muted-foreground bg-background" />
              Scale
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-4 bg-primary/10" />
              95%
            </span>
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-6 rounded-full bg-muted p-1 text-sm">
          {RANGES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              className={`h-10 rounded-full transition-colors ${
                option === range ? "bg-foreground text-background" : ""
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-7 border-t bg-background px-5 pt-6">
        <div className="mb-7 rounded-xl bg-muted/40 py-5 text-center font-medium">
          <span className="inline-flex items-center gap-2">
            <Scale className="size-4 text-primary" />
            Scale Weight
          </span>
        </div>

        {entriesByMonth.length === 0 ? (
          <div className="rounded-2xl bg-muted/40 p-5 text-sm text-muted-foreground">
            No weigh-ins yet.
          </div>
        ) : (
          entriesByMonth.map((group) => (
            <div key={group.label} className="mb-8">
              <h2 className="mb-4 text-2xl font-bold">{group.label}</h2>
              <div className="space-y-3">
                {group.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-4 rounded-2xl bg-muted/40 p-4"
                  >
                    <div className="flex size-12 items-center justify-center rounded-lg bg-background">
                      <Scale className="size-7" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xl font-medium tabular-nums">
                        {entry.weightKg.toFixed(1)} kg
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {format(isoToLocalDate(entry.logDate), "EEE, d MMM")}
                      </p>
                    </div>
                    <Button asChild type="button" variant="ghost" size="icon">
                      <Link
                        href={`/app/weigh-in?log=${entry.logDate}`}
                        aria-label="Edit weigh-in"
                      >
                        <Pencil className="size-4" />
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function WeightChart({ points }: { points: WeightTrendPointItem[] }) {
  if (points.length < 2) {
    return (
      <div className="mt-10 flex h-64 items-center justify-center text-sm text-muted-foreground">
        Add at least two weigh-ins to draw the graph.
      </div>
    );
  }

  const values = points.flatMap((point) => {
    const confidenceDelta = 1.96 * Math.sqrt(point.varianceKg2);
    return [
      point.trendWeightKg - confidenceDelta,
      point.trendWeightKg + confidenceDelta,
      ...(point.scaleWeightKg == null ? [] : [point.scaleWeightKg]),
    ];
  });
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.5);
  const trendCoords = points.map((point, index) => {
    const x = 8 + (index / (points.length - 1)) * 84;
    const confidenceDelta = 1.96 * Math.sqrt(point.varianceKg2);
    const toY = (weightKg: number) => 75 - ((weightKg - min) / range) * 45;
    return {
      point,
      x,
      y: toY(point.trendWeightKg),
      upperY: toY(point.trendWeightKg + confidenceDelta),
      lowerY: toY(point.trendWeightKg - confidenceDelta),
    };
  });
  const path = trendCoords
    .map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.y}`)
    .join(" ");
  const confidencePath = [
    ...trendCoords.map(
      (coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.upperY}`,
    ),
    ...[...trendCoords]
      .reverse()
      .map((coord) => `L ${coord.x} ${coord.lowerY}`),
    "Z",
  ].join(" ");

  return (
    <div className="mt-8 h-72">
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
        {[30, 52, 75].map((y) => (
          <line
            key={y}
            x1="0"
            x2="92"
            y1={y}
            y2={y}
            className="stroke-border"
            strokeDasharray="2 2"
            strokeWidth="0.5"
          />
        ))}
        <path d={confidencePath} className="fill-primary/10" />
        <path
          d={path}
          fill="none"
          className="stroke-primary"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        {trendCoords.map((coord) =>
          coord.point.scaleWeightKg == null ? null : (
            <circle
              key={coord.point.date}
              cx={coord.x}
              cy={75 - ((coord.point.scaleWeightKg - min) / range) * 45}
              r="1.5"
              className="fill-background stroke-muted-foreground"
              strokeWidth="1"
            />
          ),
        )}
        <text x="94" y="31" className="fill-muted-foreground text-[4px]">
          {max.toFixed(1)}
        </text>
        <text x="94" y="76" className="fill-muted-foreground text-[4px]">
          {min.toFixed(1)}
        </text>
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{format(isoToLocalDate(points[0]?.date ?? ""), "d MMM")}</span>
        <span>
          {format(isoToLocalDate(points.at(-1)?.date ?? ""), "d MMM")}
        </span>
      </div>
    </div>
  );
}

function filterEntries(
  entries: WeighInItem[],
  trend: WeightTrendPointItem[],
  range: Range,
  today: string,
): { points: WeightTrendPointItem[]; start: string; end: string } {
  const end = isoToLocalDate(today);
  const start = rangeStart(end, range, entries);
  const startIso = dateToIso(start);
  const endIso = dateToIso(end);
  const sorted = [...entries].sort((a, b) =>
    a.logDate.localeCompare(b.logDate),
  );
  const filtered = sorted.filter(
    (entry) => entry.logDate >= startIso && entry.logDate <= endIso,
  );
  const filteredTrend = trend.filter(
    (point) => point.date >= startIso && point.date <= endIso,
  );
  return {
    points:
      filteredTrend.length > 0
        ? filteredTrend
        : filtered.map((entry) => ({
            date: entry.logDate,
            trendWeightKg: entry.weightKg,
            scaleWeightKg: entry.weightKg,
            varianceKg2: 0,
            slopeKgPerWeek: null,
            hasObservation: true,
            algorithmVersion: "uncomputed",
          })),
    start: startIso,
    end: endIso,
  };
}

function rangeStart(end: Date, range: Range, entries: WeighInItem[]): Date {
  if (range === "1W") return subDays(end, 6);
  if (range === "1M") return subMonths(end, 1);
  if (range === "3M") return subMonths(end, 3);
  if (range === "6M") return subMonths(end, 6);
  if (range === "1Y") return subYears(end, 1);
  const earliest = entries.reduce<string | null>(
    (min, entry) => (min === null || entry.logDate < min ? entry.logDate : min),
    null,
  );
  return earliest ? isoToLocalDate(earliest) : end;
}

function buildRangeLabel(
  filtered: { start: string; end: string; points: WeightTrendPointItem[] },
  range: Range,
): string {
  if (filtered.points.length === 0) return "";
  const start = isoToLocalDate(filtered.start);
  const end = isoToLocalDate(filtered.end);
  if (range === "1W")
    return `${format(start, "d MMM")} - ${format(end, "d MMM yyyy")}`;
  return `${format(start, "d MMM yyyy")} - ${format(end, "d MMM yyyy")}`;
}

function formatDifference(value: number | null): string {
  if (value === null) return "--";
  const fixed = value.toFixed(1);
  if (value > 0) return `+${fixed}`;
  return fixed;
}

function groupEntriesByMonth(entries: WeighInItem[]) {
  const groups = new Map<string, WeighInItem[]>();
  for (const entry of entries) {
    const label = format(isoToLocalDate(entry.logDate), "MMMM yyyy");
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }
  return Array.from(groups, ([label, groupEntries]) => ({
    label,
    entries: groupEntries,
  }));
}
