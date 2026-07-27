"use client";

import {
  ACTIVITY_ACTOR_TYPES,
  ACTIVITY_CATEGORIES,
  ACTIVITY_METHODS,
  ACTIVITY_SEVERITIES,
  type ActivityActorType,
  type ActivityCategory,
  type ActivityFacets,
  type ActivityMethod,
  type ActivitySeverity,
  type ActivityStatusClass,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@repo/ui/select";
import { cn } from "@repo/ui/utils";
import { X } from "lucide-react";

/**
 * Radix reserves "" for clearing a Select, so "no filter" needs a sentinel of
 * its own rather than the empty string the filter state stores.
 */
const ANY = "__any__";

/** Every control in the filter row lines up on the same 28px baseline. */
const CONTROL = "h-7 text-xs";

export interface ActivityFilterState {
  category: ActivityCategory[];
  severity: ActivitySeverity[];
  actorType: ActivityActorType[];
  method: ActivityMethod[];
  statusClass: ActivityStatusClass | "";
  action: string;
  actorId: string;
  pathPrefix: string;
  ip: string;
  minDurationMs: string;
  windowHours: number;
  q: string;
}

export const DEFAULT_FILTERS: ActivityFilterState = {
  category: [],
  severity: [],
  actorType: [],
  method: [],
  statusClass: "",
  action: "",
  actorId: "",
  pathPrefix: "",
  ip: "",
  minDurationMs: "",
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
    filters.actorType.length > 0 ||
    filters.method.length > 0 ||
    filters.statusClass !== "" ||
    filters.action !== "" ||
    filters.actorId !== "" ||
    filters.pathPrefix !== "" ||
    filters.ip !== "" ||
    filters.minDurationMs !== "" ||
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
        CONTROL,
        "inline-flex items-center rounded-sm px-2 transition-colors",
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
  const methodOptions = ACTIVITY_METHODS.filter(
    (method) =>
      filters.method.includes(method) ||
      facets?.methods.some((entry) => entry.value === method),
  );
  // Actor ids are uuids; the trigger shows the username the facet resolved,
  // falling back to the id itself for an actor no longer in the window.
  const selectedActorLabel = filters.actorId
    ? (facets?.actors.find((actor) => actor.id === filters.actorId)?.label ??
      filters.actorId)
    : null;

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

        <Select
          value={filters.action || ANY}
          onValueChange={(value) =>
            onChange({ ...filters, action: value === ANY ? "" : value })
          }
        >
          <SelectTrigger
            size="sm"
            aria-label="Action"
            className={cn(CONTROL, "w-36 px-2")}
          >
            {/* Rendered here rather than via SelectValue: the item labels carry
                a count, and SelectValue would mirror that into the trigger. */}
            {filters.action ? (
              <span className="truncate font-mono">{filters.action}</span>
            ) : (
              <span className="text-muted-foreground">any action</span>
            )}
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value={ANY} className="text-xs">
              any action
            </SelectItem>
            {facets?.actions.map((entry) => (
              <SelectItem
                key={entry.value}
                value={entry.value}
                className="text-xs"
              >
                <span className="font-mono">{entry.value}</span>
                <span className="tabular-nums text-muted-foreground">
                  {entry.count}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.actorId || ANY}
          onValueChange={(value) =>
            onChange({ ...filters, actorId: value === ANY ? "" : value })
          }
        >
          <SelectTrigger
            size="sm"
            aria-label="Actor"
            className={cn(CONTROL, "w-36 px-2")}
          >
            {selectedActorLabel ? (
              <span className="truncate">{selectedActorLabel}</span>
            ) : (
              <span className="text-muted-foreground">any actor</span>
            )}
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value={ANY} className="text-xs">
              any actor
            </SelectItem>
            {facets?.actors.map((actor) => (
              <SelectItem key={actor.id} value={actor.id} className="text-xs">
                <span>{actor.label ?? actor.id}</span>
                <span className="tabular-nums text-muted-foreground">
                  {actor.count}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          aria-label="Search"
          placeholder="path, message, target…"
          className={cn(CONTROL, "w-48")}
          value={filters.q}
          onChange={(event) => onChange({ ...filters, q: event.target.value })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1">
          {ACTIVITY_ACTOR_TYPES.map((actorType) => (
            <Toggle
              key={actorType}
              active={filters.actorType.includes(actorType)}
              onClick={() =>
                onChange({
                  ...filters,
                  actorType: toggleIn(filters.actorType, actorType),
                })
              }
            >
              {actorType}
            </Toggle>
          ))}
        </div>

        {/* Driven by the facet rather than the full verb list: 14 toggles would
            bury the three a real query uses. A method still selected after it
            drops out of the window is kept so the filter stays clearable. */}
        <div className="flex flex-wrap items-center gap-1">
          {methodOptions.map((method) => (
            <Toggle
              key={method}
              active={filters.method.includes(method)}
              onClick={() =>
                onChange({
                  ...filters,
                  method: toggleIn(filters.method, method),
                })
              }
            >
              {method}
            </Toggle>
          ))}
        </div>

        <Input
          aria-label="Path prefix"
          placeholder="/dav/home"
          className={cn(CONTROL, "w-40 font-mono")}
          value={filters.pathPrefix}
          onChange={(event) =>
            onChange({ ...filters, pathPrefix: event.target.value })
          }
        />

        <Input
          aria-label="IP address"
          placeholder="ip"
          className={cn(CONTROL, "w-32 font-mono")}
          value={filters.ip}
          onChange={(event) => onChange({ ...filters, ip: event.target.value })}
        />

        <Input
          aria-label="Minimum duration in milliseconds"
          inputMode="numeric"
          placeholder="≥ ms"
          className={cn(CONTROL, "w-20 tabular-nums")}
          value={filters.minDurationMs}
          onChange={(event) =>
            onChange({
              ...filters,
              minDurationMs: event.target.value.replace(/\D/g, ""),
            })
          }
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
