"use client";

import type {
  VoiceNoteFacetsResponse,
  VoiceNoteTranscriptionStatus,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Calendar } from "@repo/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@repo/ui/command";
import { dateToIso, isoToDate } from "@repo/ui/date-picker";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { FilterTabs, SearchField, ToolbarSpacer } from "@repo/ui/toolbar";
import { ArrowUpDown, Check, ChevronDown, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  type LinkedFilter,
  SORT_LABELS,
  SORT_OPTIONS,
  SOURCE_OPTIONS,
  type VoiceNoteFilters,
} from "./voice-note-filters";
import { ContextDot } from "./voice-notes-primitives";

interface FacetOption {
  value: string;
  label: string;
  count?: number;
  dot?: { color?: string };
}

const LINKED_OPTIONS = ["all", "linked", "unlinked"] as const;

const LINKED_LABELS: Record<LinkedFilter, string> = {
  all: "All",
  linked: "Linked",
  unlinked: "Unlinked",
};

function toggle<T>(values: readonly T[], value: T) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

/** Keeps a selected value visible after its facet disappears, so it can be unchecked. */
function withSelected(options: FacetOption[], selected: readonly string[]) {
  const known = new Set(options.map((option) => option.value));
  return [
    ...options,
    ...selected
      .filter((value) => !known.has(value))
      .map((value) => ({ value, label: value, count: 0 })),
  ];
}

function summarize(labels: string[]) {
  if (labels.length === 0) return undefined;
  if (labels.length <= 2) return labels.join(", ");
  return `${labels[0]} +${labels.length - 1}`;
}

const DAY_LABEL = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

function formatDay(day: string | undefined) {
  const date = isoToDate(day);
  return date ? DAY_LABEL.format(date) : undefined;
}

function FilterTriggerButton({
  label,
  summary,
  className,
  ...props
}: ComponentProps<"button"> & { label: string; summary?: string }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] outline-none transition-colors hover:bg-surface/60 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-surface data-[state=open]:text-accent-strong",
        summary ? "pr-1 text-accent-strong" : "text-muted-foreground",
        className,
      )}
      {...props}
    >
      {label}
      {summary ? (
        <span className="max-w-40 truncate font-medium">{summary}</span>
      ) : (
        <ChevronDown className="size-3 opacity-60" />
      )}
    </button>
  );
}

function FilterSlot({
  label,
  active,
  onClear,
  children,
}: {
  label: string;
  active: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md",
        active && "bg-surface dark:bg-muted",
      )}
    >
      {children}
      {active && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear ${label.toLowerCase()} filter`}
          className="flex h-7 items-center rounded-md pr-1.5 pl-0.5 text-muted-foreground hover:text-accent-strong"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

function OptionCount({ count }: { count?: number }) {
  if (count === undefined) return null;
  return (
    <span className="ml-auto pl-3 text-[11px] tabular-nums text-muted-foreground">
      {count}
    </span>
  );
}

function CheckboxMenuFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: FacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const summary = summarize(
    options
      .filter((option) => selected.includes(option.value))
      .map((option) => option.label),
  );
  return (
    <FilterSlot
      label={label}
      active={selected.length > 0}
      onClear={() => onChange([])}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <FilterTriggerButton label={label} summary={summary} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={selected.includes(option.value)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => onChange(toggle(selected, option.value))}
            >
              {option.label}
              <OptionCount count={option.count} />
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </FilterSlot>
  );
}

function matchLabel(_value: string, search: string, keywords?: string[]) {
  const haystack = (keywords ?? []).join(" ").toLowerCase();
  return haystack.includes(search.trim().toLowerCase()) ? 1 : 0;
}

function SearchableFilter({
  label,
  options,
  selected,
  onChange,
  loading,
  prefix,
}: {
  label: string;
  options: FacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  loading: boolean;
  prefix?: string;
}) {
  const summary = summarize(
    options
      .filter((option) => selected.includes(option.value))
      .map((option) => `${prefix ?? ""}${option.label}`),
  );
  return (
    <FilterSlot
      label={label}
      active={selected.length > 0}
      onClear={() => onChange([])}
    >
      <Popover>
        <PopoverTrigger asChild>
          <FilterTriggerButton label={label} summary={summary} />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 p-0">
          <Command filter={matchLabel}>
            {options.length > 6 && (
              <CommandInput className="h-8 text-xs" placeholder={label} />
            )}
            <CommandList>
              <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
                {loading ? "…" : "—"}
              </CommandEmpty>
              <CommandGroup>
                {options.map((option) => {
                  const checked = selected.includes(option.value);
                  return (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      keywords={[option.label]}
                      onSelect={() => onChange(toggle(selected, option.value))}
                      className="text-xs"
                    >
                      <Check
                        className={cn(
                          "size-3.5",
                          checked ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {option.dot && <ContextDot color={option.dot.color} />}
                      <span className="truncate">
                        {prefix}
                        {option.label}
                      </span>
                      <OptionCount count={option.count} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </FilterSlot>
  );
}

function ContextFilterControl({
  filters,
  facets,
  onChange,
}: {
  filters: VoiceNoteFilters;
  facets: VoiceNoteFacetsResponse | null;
  onChange: (context: VoiceNoteFilters["context"]) => void;
}) {
  const { context } = filters;
  const selectedIds = context.mode === "ids" ? context.ids : [];
  const options = withSelected(
    (facets?.contexts ?? []).map((item) => ({
      value: item.id,
      label: item.title,
      count: item.count,
    })),
    selectedIds,
  );
  const summary =
    context.mode === "any"
      ? "any"
      : context.mode === "none"
        ? "none"
        : summarize(
            options
              .filter((option) => selectedIds.includes(option.value))
              .map((option) => option.label),
          );

  const toggleId = (id: string) => {
    const ids = toggle(selectedIds, id);
    onChange(ids.length > 0 ? { mode: "ids", ids } : { mode: "all" });
  };

  return (
    <FilterSlot
      label="Context"
      active={context.mode !== "all"}
      onClear={() => onChange({ mode: "all" })}
    >
      <Popover>
        <PopoverTrigger asChild>
          <FilterTriggerButton label="Context" summary={summary} />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <Command filter={matchLabel}>
            {options.length > 6 && (
              <CommandInput className="h-8 text-xs" placeholder="Context" />
            )}
            <CommandList>
              <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
                —
              </CommandEmpty>
              <CommandGroup>
                {(["any", "none"] as const).map((mode) => (
                  <CommandItem
                    key={mode}
                    value={`mode:${mode}`}
                    keywords={[mode === "any" ? "any" : "none"]}
                    onSelect={() =>
                      onChange(
                        context.mode === mode ? { mode: "all" } : { mode },
                      )
                    }
                    className="text-xs"
                  >
                    <Check
                      className={cn(
                        "size-3.5",
                        context.mode === mode ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {mode === "any" ? "Any context" : "No context"}
                  </CommandItem>
                ))}
              </CommandGroup>
              {options.length > 0 && <CommandSeparator />}
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label]}
                    onSelect={() => toggleId(option.value)}
                    className="text-xs"
                  >
                    <Check
                      className={cn(
                        "size-3.5",
                        selectedIds.includes(option.value)
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                    <OptionCount count={option.count} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </FilterSlot>
  );
}

function DateRangeFilter({
  from,
  to,
  onChange,
}: {
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
}) {
  const fromLabel = formatDay(from);
  const toLabel = formatDay(to);
  const summary =
    fromLabel && toLabel
      ? fromLabel === toLabel
        ? fromLabel
        : `${fromLabel} – ${toLabel}`
      : fromLabel
        ? `from ${fromLabel}`
        : toLabel
          ? `to ${toLabel}`
          : undefined;
  const fromDate = isoToDate(from);
  const toDate = isoToDate(to);

  return (
    <FilterSlot
      label="Date"
      active={Boolean(from || to)}
      onClear={() => onChange({})}
    >
      <Popover>
        <PopoverTrigger asChild>
          <FilterTriggerButton label="Date" summary={summary} />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="range"
            selected={
              fromDate || toDate ? { from: fromDate, to: toDate } : undefined
            }
            defaultMonth={fromDate ?? toDate}
            onSelect={(range) =>
              onChange({
                from: range?.from ? dateToIso(range.from) : undefined,
                to: range?.to ? dateToIso(range.to) : undefined,
              })
            }
          />
        </PopoverContent>
      </Popover>
    </FilterSlot>
  );
}

type StatusTab = "all" | "failed" | "pending" | "untranscribed" | "transcribed";

const STATUS_TABS: Record<StatusTab, VoiceNoteTranscriptionStatus[]> = {
  all: [],
  failed: ["failed"],
  pending: ["queued", "transcribing"],
  untranscribed: ["untranscribed"],
  transcribed: ["transcribed"],
};

const STATUS_TAB_LABELS: Record<StatusTab, string> = {
  all: "All",
  failed: "Failed",
  pending: "Pending",
  untranscribed: "Untranscribed",
  transcribed: "Transcribed",
};

const STATUS_TAB_KEYS: StatusTab[] = [
  "all",
  "failed",
  "pending",
  "untranscribed",
  "transcribed",
];

function statusTabOf(statuses: VoiceNoteTranscriptionStatus[]): StatusTab {
  return (
    STATUS_TAB_KEYS.find((tab) => {
      const preset = STATUS_TABS[tab];
      return (
        preset.length === statuses.length &&
        preset.every((status) => statuses.includes(status))
      );
    }) ?? "all"
  );
}

/** Search, status tabs, facet filters and sort — the page toolbar's contents. */
export function VoiceNotesFilterBar({
  query,
  onQueryChange,
  filters,
  facets,
  onChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  filters: VoiceNoteFilters;
  facets: VoiceNoteFacetsResponse | null;
  onChange: (filters: VoiceNoteFilters) => void;
}) {
  const update = (patch: Partial<VoiceNoteFilters>) =>
    onChange({ ...filters, ...patch });

  const statusCount = (tab: StatusTab) => {
    if (!facets) return undefined;
    if (tab === "all") {
      return facets.statuses.reduce((sum, item) => sum + item.count, 0);
    }
    return facets.statuses
      .filter((item) => STATUS_TABS[tab].includes(item.status))
      .reduce((sum, item) => sum + item.count, 0);
  };
  const sourceCount = (source: string) =>
    facets
      ? (facets.sources.find((item) => item.source === source)?.count ?? 0)
      : undefined;
  const filtersActive = hasActiveFilters({ ...filters, statuses: [] });

  return (
    <>
      <SearchField
        value={query}
        onChange={onQueryChange}
        placeholder="Search"
        className="w-full sm:w-56"
      />
      <FilterTabs
        value={statusTabOf(filters.statuses)}
        onChange={(tab) => update({ statuses: STATUS_TABS[tab] })}
        options={STATUS_TAB_KEYS.map((tab) => ({
          value: tab,
          label: STATUS_TAB_LABELS[tab],
          count: tab === "all" ? undefined : statusCount(tab),
        }))}
      />
      <div className="flex flex-wrap items-center gap-0.5">
        <SearchableFilter
          label="Tags"
          prefix="#"
          loading={!facets}
          options={withSelected(
            (facets?.tags ?? []).map((tag) => ({
              value: tag.name,
              label: tag.name,
              count: tag.count,
            })),
            filters.tags,
          )}
          selected={filters.tags}
          onChange={(tags) => update({ tags })}
        />
        <SearchableFilter
          label="Groups"
          loading={!facets}
          options={withSelected(
            (facets?.groups ?? []).map((group) => ({
              value: group._id,
              label: group.name,
              count: group.count,
              dot: { color: group.color },
            })),
            filters.groupIds,
          )}
          selected={filters.groupIds}
          onChange={(groupIds) => update({ groupIds })}
        />
        <ContextFilterControl
          filters={filters}
          facets={facets}
          onChange={(context) => update({ context })}
        />
        <CheckboxMenuFilter
          label="Source"
          options={SOURCE_OPTIONS.map((source) => ({
            value: source,
            label: source,
            count: sourceCount(source),
          }))}
          selected={filters.sources}
          onChange={(values) =>
            update({
              sources: SOURCE_OPTIONS.filter((source) =>
                values.includes(source),
              ),
            })
          }
        />
        <FilterSlot
          label="Linked"
          active={filters.linked !== "all"}
          onClear={() => update({ linked: "all" })}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterTriggerButton
                label="Linked"
                summary={
                  filters.linked === "all"
                    ? undefined
                    : LINKED_LABELS[filters.linked].toLowerCase()
                }
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-36">
              <DropdownMenuRadioGroup
                value={filters.linked}
                onValueChange={(value) => {
                  const linked = LINKED_OPTIONS.find(
                    (option) => option === value,
                  );
                  if (linked) update({ linked });
                }}
              >
                {LINKED_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option} value={option}>
                    {LINKED_LABELS[option]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </FilterSlot>
        <DateRangeFilter
          from={filters.from}
          to={filters.to}
          onChange={({ from, to }) => update({ from, to })}
        />
        {filtersActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() =>
              onChange({
                ...DEFAULT_FILTERS,
                statuses: filters.statuses,
                sort: filters.sort,
              })
            }
          >
            Clear
          </Button>
        )}
      </div>

      <ToolbarSpacer />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground data-[state=open]:bg-surface"
          >
            <ArrowUpDown />
            {SORT_LABELS[filters.sort]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-32">
          <DropdownMenuRadioGroup
            value={filters.sort}
            onValueChange={(value) => {
              const sort = SORT_OPTIONS.find((option) => option === value);
              if (sort) update({ sort });
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {SORT_LABELS[option]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
