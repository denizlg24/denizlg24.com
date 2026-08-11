"use client";

import { deploymentTone } from "@repo/cloud-ui/deploy-status";
import {
  DEPLOYMENT_STATUSES,
  type DeploymentStatus,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Calendar } from "@repo/ui/calendar";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@repo/ui/combobox";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { StatusDot } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { CalendarIcon, CheckIcon, ChevronDown, Search } from "lucide-react";
import { useState } from "react";

/**
 * Every control on the deployments bar is the same button until it opens: a
 * bordered, muted trigger that goes solid once it holds a value. Written once so
 * a select, a popover and a combobox cannot drift apart by a pixel — which is
 * exactly what happened while they were three different native elements.
 */
const TRIGGER =
  "flex h-9 items-center gap-2 rounded-md border bg-transparent px-3 text-xs whitespace-nowrap transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50";

function triggerTone(active: boolean): string {
  return active ? "text-foreground" : "text-muted-foreground";
}

const DATE_LABEL = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

function toIsoDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function fromIsoDay(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Two bare `YYYY-MM-DD` strings, selected as one range.
 *
 * They stay day strings in the URL rather than timestamps because that is what
 * the range means — "these days", in the reader's own timezone. Widening them
 * to instants happens at the query, where local midnight is the correct
 * boundary; parsing them as UTC instead shifts it by the offset and silently
 * drops the first or last hours of the range.
 */
export function DateRangeFilter({
  since,
  until,
  onChange,
}: {
  since: string | null;
  until: string | null;
  onChange: (range: { since: string | null; until: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const from = fromIsoDay(since);
  const to = fromIsoDay(until);
  // Structural rather than react-day-picker's `DateRange`: the type lives in a
  // package `@repo/ui` depends on and this app does not, and adding a direct
  // dependency to name one two-field object is the wrong trade.
  const selected = from ? { from, to } : undefined;

  const label = from
    ? `${DATE_LABEL.format(from)}${to ? ` – ${DATE_LABEL.format(to)}` : ""}`
    : "Select Date Range";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(TRIGGER, triggerTone(Boolean(from)), "min-w-52")}
      >
        <CalendarIcon className="size-3.5 shrink-0" />
        <span className="flex-1 text-left">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          numberOfMonths={2}
          autoFocus
          selected={selected}
          onSelect={(range) =>
            onChange({
              since: range?.from ? toIsoDay(range.from) : null,
              until: range?.to ? toIsoDay(range.to) : null,
            })
          }
        />
        <div className="flex justify-end border-t p-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!from}
            onClick={() => {
              onChange({ since: null, until: null });
              setOpen(false);
            }}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The row's own checked state, drawn rather than composed.
 *
 * `@repo/ui`'s Checkbox is a Radix root, which renders a `button` — nesting one
 * inside the row button is invalid HTML and fails hydration. The row is the
 * control here (`menuitemcheckbox` carries the state to assistive tech), so the
 * box only has to look like one.
 */
function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-4 shrink-0 place-content-center rounded-[4px] border transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border dark:bg-border/30",
      )}
    >
      {checked ? <CheckIcon className="size-3.5" /> : null}
    </span>
  );
}

/**
 * Statuses are a set, not a choice, so this is a popover of checkboxes with the
 * count on the trigger rather than a select. The dots carry the same tones the
 * rows do, which is what makes "which of these is red" answerable without
 * reading seven words.
 */
export function StatusFilter({
  selected,
  onChange,
}: {
  selected: readonly DeploymentStatus[];
  onChange: (statuses: DeploymentStatus[]) => void;
}) {
  const active = selected.length > 0;
  const toggle = (status: DeploymentStatus) =>
    onChange(
      selected.includes(status)
        ? selected.filter((entry) => entry !== status)
        : [...selected, status],
    );

  return (
    <Popover>
      <PopoverTrigger className={cn(TRIGGER, triggerTone(active))}>
        <span className="flex items-center -space-x-1">
          {(active ? selected : DEPLOYMENT_STATUSES)
            .slice(0, 3)
            .map((status) => (
              <StatusDot
                key={status}
                tone={deploymentTone(status)}
                className="size-2 ring-2 ring-background"
              />
            ))}
        </span>
        <span>Status</span>
        <span className="tabular-nums text-muted-foreground">
          {active ? selected.length : DEPLOYMENT_STATUSES.length}/
          {DEPLOYMENT_STATUSES.length}
        </span>
        <ChevronDown className="size-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        {DEPLOYMENT_STATUSES.map((status) => {
          // Nothing selected means nothing is filtered out, so every box reads
          // as checked. A bar of empty boxes above a full list is the wrong
          // description of what is on screen.
          const checked = active ? selected.includes(status) : true;
          return (
            <button
              key={status}
              type="button"
              role="menuitemcheckbox"
              aria-checked={checked}
              onClick={() => toggle(status)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <CheckMark checked={checked} />
              <StatusDot tone={deploymentTone(status)} className="size-2" />
              <span className="flex-1">{status}</span>
            </button>
          );
        })}
        {active ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="w-full rounded-sm px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-accent"
          >
            reset
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A searchable single-choice filter over a list of strings.
 *
 * A combobox rather than a select because both lists it renders — repositories
 * and refs — are long enough that scrolling is not how anyone finds the entry
 * they came for. The server caps branches at 200 per project for the same
 * reason.
 */
export function SearchFilter({
  value,
  onChange,
  options,
  allLabel,
  emptyLabel,
  className,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  options: readonly string[];
  allLabel: string;
  emptyLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(TRIGGER, triggerTone(value !== null), "w-52", className)}
      >
        <Search className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">
          {value ?? allLabel}
        </span>
        <ChevronDown className="size-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Combobox
          items={options as string[]}
          value={value}
          onValueChange={(next: string | null) => {
            onChange(next);
            setOpen(false);
          }}
        >
          <ComboboxInput
            placeholder={allLabel}
            className="border-0 shadow-none"
          />
          <ComboboxContent className="border-0 shadow-none">
            <ComboboxEmpty className="px-2 py-3 text-xs text-muted-foreground">
              {emptyLabel}
            </ComboboxEmpty>
            <ComboboxList>
              {(option: string) => (
                <ComboboxItem
                  key={option}
                  value={option}
                  className="truncate text-xs"
                >
                  {option}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        {value === null ? null : (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="w-full border-t px-3 py-2 text-left text-[11px] text-muted-foreground hover:bg-accent"
          >
            {allLabel}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export { TRIGGER as FILTER_TRIGGER, triggerTone as filterTriggerTone };
