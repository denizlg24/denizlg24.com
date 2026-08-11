"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import type { MetricCatalogEntry, MetricSeries } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@repo/ui/combobox";
import { Skeleton } from "@repo/ui/skeleton";
import { X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { MetricChart, type MetricFormat } from "../metric-chart";

/**
 * `metricsQuerySchema` refuses more than fifty series in one query, so a box
 * publishing two hundred cannot be charted in a single request. Requests are
 * batched at this size and merged; the guardrail exists to bound the point count
 * a single query can return, and several small queries respect it honestly.
 */
const SERIES_PER_QUERY = 50;

const WINDOWS = [
  { label: "1h", hours: 1, step: 30 },
  { label: "6h", hours: 6, step: 120 },
  { label: "24h", hours: 24, step: 300 },
  { label: "7d", hours: 168, step: 1_800 },
] as const;

/**
 * What the box is doing right now is worth watching by default; everything else
 * is one pick away. Chosen because they are the series every machine has, so the
 * page is never empty on first load whatever hardware is in it.
 */
const DEFAULT_SERIES = [
  "forge-host:cpu.usage_percent",
  "forge-host:memory.usage_percent",
  "forge-host:load.1",
  "forge-host:cpu.temperature_celsius",
];

function formatFor(unit: MetricCatalogEntry["unit"]): MetricFormat {
  switch (unit) {
    case "percent":
      return "percent";
    case "bytes":
    case "bytes_per_second":
      return "bytes";
    // `celsius`, `ratio` and `count` all render as plain numbers; the axis
    // label carries the unit, and rounding a temperature to a whole degree
    // would lose the only precision it has.
    default:
      return "raw";
  }
}

interface Group {
  value: string;
  items: MetricCatalogEntry[];
}

/**
 * Charts over whatever the host is actually recording.
 *
 * Driven by the catalog rather than a fixed list of panels: the series a machine
 * publishes depend on its hardware — one per sensor the board exposes, per core,
 * per disk, per interface — so a page with hard-coded charts is either wrong on
 * the next machine or wrong the moment a drive is added.
 *
 * Series are grouped into one chart per unit. Plotting a fan at 1200 rpm beside
 * a temperature at 45 °C on one axis makes the temperature a flat line at the
 * bottom.
 */
export function SeriesCharts({
  catalog,
}: {
  catalog: readonly MetricCatalogEntry[];
}) {
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>(WINDOWS[2]);
  const [selected, setSelected] = useState<string[]>(() =>
    DEFAULT_SERIES.filter((name) =>
      catalog.some((entry) => entry.name === name),
    ),
  );

  const groups = useMemo<Group[]>(() => {
    const byGroup = new Map<string, MetricCatalogEntry[]>();
    for (const entry of catalog) {
      const bucket = byGroup.get(entry.group);
      if (bucket) bucket.push(entry);
      else byGroup.set(entry.group, [entry]);
    }
    return [...byGroup.entries()].map(([group, items]) => ({
      value: group,
      items,
    }));
  }, [catalog]);

  const chosen = useMemo(
    () =>
      selected
        .map((name) => catalog.find((entry) => entry.name === name))
        .filter((entry): entry is MetricCatalogEntry => entry !== undefined),
    [selected, catalog],
  );

  const fetchMetrics = useCallback(async (): Promise<MetricSeries[]> => {
    if (selected.length === 0) return [];
    const to = new Date();
    const from = new Date(to.getTime() - window.hours * 60 * 60 * 1_000);
    const batches: string[][] = [];
    for (let index = 0; index < selected.length; index += SERIES_PER_QUERY) {
      batches.push(selected.slice(index, index + SERIES_PER_QUERY));
    }
    const responses = await Promise.all(
      batches.map((series) =>
        api.forge.metrics({
          series,
          from: from.toISOString(),
          to: to.toISOString(),
          step: window.step,
        }),
      ),
    );
    return responses.flatMap((response) => response.series);
  }, [selected, window]);

  const { data, error, loading } = usePoll(fetchMetrics, 60_000);

  // One chart per unit, so nothing shares an axis with something a thousand
  // times its size.
  const charts = useMemo(() => {
    const byUnit = new Map<string, MetricCatalogEntry[]>();
    for (const entry of chosen) {
      const bucket = byUnit.get(entry.unit);
      if (bucket) bucket.push(entry);
      else byUnit.set(entry.unit, [entry]);
    }
    return [...byUnit.entries()];
  }, [chosen]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Combobox
          items={groups}
          value={null}
          onValueChange={(entry: MetricCatalogEntry | null) => {
            if (!entry) return;
            setSelected((current) =>
              current.includes(entry.name) ? current : [...current, entry.name],
            );
          }}
          itemToStringLabel={(entry: MetricCatalogEntry) => entry.label}
          isItemEqualToValue={(a: MetricCatalogEntry, b: MetricCatalogEntry) =>
            a.name === b.name
          }
        >
          <ComboboxInput
            placeholder={`add a series (${catalog.length} recorded)`}
            className="h-8 w-72 text-xs"
          />
          <ComboboxContent>
            <ComboboxEmpty className="px-2 py-3 text-xs text-muted-foreground">
              no series matches
            </ComboboxEmpty>
            <ComboboxList>
              {(group: Group) => (
                <ComboboxGroup key={group.value} items={group.items}>
                  <ComboboxLabel className="text-[11px] uppercase tracking-wider">
                    {group.value}
                  </ComboboxLabel>
                  <ComboboxCollection>
                    {(entry: MetricCatalogEntry) => (
                      <ComboboxItem
                        key={entry.name}
                        value={entry}
                        className="w-full min-w-0 flex-col items-start gap-0 py-1.5"
                      >
                        <span className="w-full min-w-0 truncate text-xs">
                          {entry.label}
                        </span>
                        <span className="w-full min-w-0 truncate font-mono text-[10px] text-muted-foreground/70">
                          {entry.name}
                        </span>
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>

        <div className="flex items-center gap-1">
          {WINDOWS.map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={option.label === window.label}
              onClick={() => setWindow(option)}
              className={
                option.label === window.label
                  ? "rounded-full bg-foreground px-2 py-0.5 text-[11px] text-background"
                  : "rounded-full px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        {selected.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px]"
            onClick={() => setSelected([])}
          >
            clear
          </Button>
        ) : null}
      </div>

      {chosen.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((entry) => (
            <button
              key={entry.name}
              type="button"
              onClick={() =>
                setSelected((current) =>
                  current.filter((name) => name !== entry.name),
                )
              }
              className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              title={entry.name}
            >
              {entry.label}
              <X className="size-2.5" />
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {selected.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : null}
      {!data && !error && selected.length > 0 ? (
        <div className="grid gap-8 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : null}

      {data && charts.length > 0 ? (
        <div
          className={
            loading
              ? "grid gap-8 opacity-60 transition-opacity md:grid-cols-2"
              : "grid gap-8 opacity-100 transition-opacity md:grid-cols-2"
          }
        >
          {charts.map(([unit, entries]) => (
            <MetricChart
              key={unit}
              title={unit.replace(/_/g, " ")}
              names={entries.map((entry) => entry.name)}
              data={data}
              format={formatFor(entries[0]?.unit ?? "count")}
              labels={Object.fromEntries(
                entries.map((entry) => [entry.name, entry.label]),
              )}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
