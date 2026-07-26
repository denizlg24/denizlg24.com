"use client";

import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_SEVERITIES,
  type ActivityCategory,
  type ActivityFacets,
  type ActivitySeverity,
  type ActivityStatusClass,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { NativeSelect } from "@repo/ui/native-select";
import { cn } from "@repo/ui/utils";
import { X } from "lucide-react";

export interface ActivityFilterState {
  category: ActivityCategory[];
  severity: ActivitySeverity[];
  statusClass: ActivityStatusClass | "";
  action: string;
  actorId: string;
  windowHours: number;
  q: string;
}

export const DEFAULT_FILTERS: ActivityFilterState = {
  category: [],
  severity: [],
  statusClass: "",
  action: "",
  actorId: "",
  windowHours: 24,
  q: "",
};

const WINDOWS = [
  { hours: 1, label: "1h" },
  { hours: 24, label: "24h" },
  { hours: 24 * 7, label: "7d" },
  { hours: 24 * 30, label: "30d" },
  { hours: 0, label: "all" },
];

const STATUS_CLASSES: { value: ActivityStatusClass; label: string }[] = [
  { value: "success", label: "2xx/3xx" },
  { value: "client_error", label: "4xx" },
  { value: "server_error", label: "5xx" },
];

export function isFiltered(filters: ActivityFilterState): boolean {
  return (
    filters.category.length > 0 ||
    filters.severity.length > 0 ||
    filters.statusClass !== "" ||
    filters.action !== "" ||
    filters.actorId !== "" ||
    filters.q !== "" ||
    filters.windowHours !== DEFAULT_FILTERS.windowHours
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-xs transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function toggleIn<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

export function ActivityFilters({
  filters,
  facets,
  onChange,
}: {
  filters: ActivityFilterState;
  facets: ActivityFacets | null;
  onChange: (next: ActivityFilterState) => void;
}) {
  const counts = new Map(
    facets?.categories.map((entry) => [entry.value, entry.count]),
  );

  return (
    <div className="flex flex-col gap-3 border-y py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1">
          {ACTIVITY_CATEGORIES.map((category) => (
            <Toggle
              key={category}
              active={filters.category.includes(category)}
              onClick={() =>
                onChange({
                  ...filters,
                  category: toggleIn(filters.category, category),
                })
              }
            >
              {counts.has(category)
                ? `${category} ${counts.get(category)}`
                : category}
            </Toggle>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          {ACTIVITY_SEVERITIES.map((severity) => (
            <Toggle
              key={severity}
              active={filters.severity.includes(severity)}
              onClick={() =>
                onChange({
                  ...filters,
                  severity: toggleIn(filters.severity, severity),
                })
              }
            >
              {severity}
            </Toggle>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {STATUS_CLASSES.map((status) => (
            <Toggle
              key={status.value}
              active={filters.statusClass === status.value}
              onClick={() =>
                onChange({
                  ...filters,
                  statusClass:
                    filters.statusClass === status.value ? "" : status.value,
                })
              }
            >
              {status.label}
            </Toggle>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {WINDOWS.map((window) => (
            <Toggle
              key={window.hours}
              active={filters.windowHours === window.hours}
              onClick={() =>
                onChange({ ...filters, windowHours: window.hours })
              }
            >
              {window.label}
            </Toggle>
          ))}
        </div>

        <NativeSelect
          aria-label="Action"
          className="h-7 w-auto min-w-32 text-xs"
          value={filters.action}
          onChange={(event) =>
            onChange({ ...filters, action: event.target.value })
          }
        >
          <option value="">any action</option>
          {facets?.actions.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.value} ({entry.count})
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="Actor"
          className="h-7 w-auto min-w-32 text-xs"
          value={filters.actorId}
          onChange={(event) =>
            onChange({ ...filters, actorId: event.target.value })
          }
        >
          <option value="">any actor</option>
          {facets?.actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.label ?? actor.id} ({actor.count})
            </option>
          ))}
        </NativeSelect>

        <Input
          aria-label="Search"
          placeholder="path, message, target…"
          className="h-7 w-48 text-xs"
          value={filters.q}
          onChange={(event) => onChange({ ...filters, q: event.target.value })}
        />

        {isFiltered(filters) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => onChange(DEFAULT_FILTERS)}
          >
            <X className="size-3" />
            reset
          </Button>
        )}
      </div>
    </div>
  );
}
