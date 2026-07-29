"use client";

import type { MetricCatalogEntry } from "@repo/schemas/cloud";
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
import { useMemo } from "react";
import { formatValue } from "./format-metric";

interface Group {
  value: string;
  items: MetricCatalogEntry[];
}

/**
 * Searchable and grouped, because the catalog is long and the raw series names
 * are the wrong thing to scan: a container series is keyed by its id, so the
 * resolved label is the only readable identifier. The raw name still renders
 * underneath, since it is what a JSON rule has to carry.
 */
export function SeriesPicker({
  catalog,
  value,
  onChange,
  id,
}: {
  catalog: MetricCatalogEntry[];
  value: string;
  onChange: (entry: MetricCatalogEntry) => void;
  id?: string;
}) {
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

  const selected = useMemo(
    () => catalog.find((entry) => entry.name === value) ?? null,
    [catalog, value],
  );

  return (
    <Combobox
      items={groups}
      value={selected}
      onValueChange={(entry: MetricCatalogEntry | null) => {
        if (entry) onChange(entry);
      }}
      itemToStringLabel={(entry: MetricCatalogEntry) => entry.label}
      isItemEqualToValue={(a: MetricCatalogEntry, b: MetricCatalogEntry) =>
        a.name === b.name
      }
    >
      <ComboboxInput
        id={id}
        placeholder="search metrics"
        className="h-8 w-80 text-xs"
      />
      <ComboboxContent>
        <ComboboxEmpty className="px-2 py-3 text-xs text-muted-foreground">
          no metric matches
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
                    <span className="flex w-full min-w-0 items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-xs">
                        {entry.label}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {entry.lastValue === null
                          ? "—"
                          : formatValue(entry.lastValue, entry.unit)}
                      </span>
                    </span>
                    {/* `items-start` sizes children to their content, so without
                        an explicit width there is no box for the ellipsis to
                        appear in and a long container series name overflows. */}
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
  );
}
