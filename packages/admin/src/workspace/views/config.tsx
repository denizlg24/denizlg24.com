"use client";

import {
  VIEW_FILTER_OPS_BY_TYPE,
  VIEW_LAYOUTS,
  VIEW_LIMIT_MAX,
  VIEW_SOURCE_IDS,
  VIEW_SOURCES,
  VIEW_UNARY_OPS,
  type ViewConfig,
  type ViewFieldDef,
  type ViewFilter,
  type ViewFilterOp,
  type ViewLayout,
  type ViewSourceId,
  viewDateField,
} from "@repo/schemas";
import { cn } from "@repo/ui/utils";
import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";

const LABEL =
  "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";
const SELECT =
  "min-w-0 rounded-sm bg-transparent py-0.5 text-xs outline-none hover:bg-surface focus:bg-surface";
const INPUT =
  "min-w-0 flex-1 rounded-sm bg-surface/60 px-1.5 py-0.5 text-xs outline-none";

const OP_LABEL: Record<ViewFilterOp, string> = {
  contains: "contains",
  not_contains: "doesn't contain",
  is: "is",
  is_not: "is not",
  any_of: "any of",
  none_of: "none of",
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  on: "on",
  before: "before",
  after: "after",
  on_or_before: "on or before",
  on_or_after: "on or after",
  past_days: "past days",
  next_days: "next days",
  empty: "is empty",
  not_empty: "is not empty",
};

const LAYOUT_LABEL: Record<ViewLayout, string> = {
  table: "Table",
  list: "List",
  board: "Board",
  calendar: "Calendar",
  gallery: "Gallery",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className={cn(LABEL, "w-14 shrink-0 pt-1")}>{label}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
    </div>
  );
}

function defaultValue(
  def: ViewFieldDef,
  op: ViewFilterOp,
): ViewFilter["value"] {
  if (VIEW_UNARY_OPS.includes(op)) return undefined;
  if (op === "past_days" || op === "next_days") return 7;
  if (op === "any_of" || op === "none_of") return [];
  if (def.type === "boolean") return true;
  if (def.type === "number" || def.type === "money") return 0;
  return "";
}

function FilterValue({
  def,
  filter,
  options,
  onChange,
}: {
  def: ViewFieldDef;
  filter: ViewFilter;
  options: readonly string[];
  onChange: (value: ViewFilter["value"]) => void;
}) {
  const { op, value } = filter;
  if (VIEW_UNARY_OPS.includes(op)) return null;
  if (
    op === "past_days" ||
    op === "next_days" ||
    def.type === "number" ||
    def.type === "money"
  ) {
    return (
      <input
        type="number"
        aria-label="Value"
        value={typeof value === "number" ? value : Number(value ?? 0)}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber || 0)}
        className={cn(INPUT, "max-w-24 tabular-nums")}
      />
    );
  }
  if (def.type === "boolean") {
    return (
      <select
        aria-label="Value"
        value={value === true || value === "true" ? "true" : "false"}
        onChange={(event) => onChange(event.currentTarget.value === "true")}
        className={SELECT}
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (def.type === "date") {
    return (
      <input
        type="date"
        aria-label="Value"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={INPUT}
      />
    );
  }
  if (
    (def.type === "select" || def.type === "person") &&
    (op === "any_of" || op === "none_of")
  ) {
    const chosen = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const on = chosen.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onChange(
                  on ? chosen.filter((v) => v !== option) : [...chosen, option],
                )
              }
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-xs",
                on
                  ? "bg-surface text-accent-strong"
                  : "text-muted-foreground hover:bg-surface/60",
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    );
  }
  if ((def.type === "select" || def.type === "person") && options.length > 0) {
    return (
      <select
        aria-label="Value"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={SELECT}
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label="Value"
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.currentTarget.value)}
      className={INPUT}
    />
  );
}

/** The config of one view block; every change is a whole new config. */
export function ViewConfigEditor({
  config,
  options,
  onChange,
}: {
  config: ViewConfig;
  /** Select values seen in the last answer, per field. */
  options: Record<string, string[]>;
  onChange: (config: ViewConfig) => void;
}) {
  const descriptor = VIEW_SOURCES[config.source];
  const fieldEntries = Object.entries(descriptor.fields);
  const groupable = fieldEntries.filter(([, def]) =>
    ["select", "boolean", "person"].includes(def.type),
  );
  const dateFields = fieldEntries.filter(([, def]) => def.type === "date");
  const shown = config.fields ?? [...descriptor.defaultFields];
  const set = (patch: Partial<ViewConfig>) => onChange({ ...config, ...patch });
  const setFilter = (index: number, filter: ViewFilter) =>
    set({ filters: config.filters.map((f, i) => (i === index ? filter : f)) });

  return (
    <div data-view-config="" className="flex flex-col gap-3 text-sm">
      <Row label="Source">
        <select
          aria-label="Source"
          value={config.source}
          onChange={(event) => {
            const source = VIEW_SOURCE_IDS.find(
              (id) => id === event.currentTarget.value,
            );
            if (source) changeSource(config, source, onChange);
          }}
          className={SELECT}
        >
          {VIEW_SOURCE_IDS.map((id) => (
            <option key={id} value={id}>
              {VIEW_SOURCES[id].label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Layout">
        <div
          role="radiogroup"
          aria-label="Layout"
          className="flex flex-wrap gap-0.5"
        >
          {VIEW_LAYOUTS.map((layout) => (
            <button
              key={layout}
              type="button"
              role="radio"
              aria-checked={config.layout === layout}
              onClick={() => set({ layout })}
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-xs",
                config.layout === layout
                  ? "bg-surface text-accent-strong"
                  : "text-muted-foreground hover:text-accent-strong",
              )}
            >
              {LAYOUT_LABEL[layout]}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Filter">
        {config.filters.map((filter, index) => {
          const def = descriptor.fields[filter.field];
          if (!def) return null;
          return (
            <div
              key={index}
              data-filter={index}
              className="flex flex-wrap items-center gap-1"
            >
              <select
                aria-label="Field"
                value={filter.field}
                onChange={(event) => {
                  const field = event.currentTarget.value;
                  const next = descriptor.fields[field];
                  if (!next) return;
                  const op = VIEW_FILTER_OPS_BY_TYPE[next.type][0] ?? "empty";
                  setFilter(index, {
                    field,
                    op,
                    value: defaultValue(next, op),
                  });
                }}
                className={SELECT}
              >
                {fieldEntries.map(([key, d]) => (
                  <option key={key} value={key}>
                    {d.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Operator"
                value={filter.op}
                onChange={(event) => {
                  const op = VIEW_FILTER_OPS_BY_TYPE[def.type].find(
                    (o) => o === event.currentTarget.value,
                  );
                  if (op)
                    setFilter(index, {
                      ...filter,
                      op,
                      value: defaultValue(def, op),
                    });
                }}
                className={SELECT}
              >
                {VIEW_FILTER_OPS_BY_TYPE[def.type].map((op) => (
                  <option key={op} value={op}>
                    {OP_LABEL[op]}
                  </option>
                ))}
              </select>
              <FilterValue
                def={def}
                filter={filter}
                options={def.options ?? options[filter.field] ?? []}
                onChange={(value) => setFilter(index, { ...filter, value })}
              />
              <button
                type="button"
                aria-label="Remove filter"
                onClick={() =>
                  set({ filters: config.filters.filter((_, i) => i !== index) })
                }
                className="rounded-sm p-0.5 text-muted-foreground hover:bg-surface"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => {
            const [field, def] = fieldEntries[0] ?? [];
            if (!field || !def) return;
            const op = VIEW_FILTER_OPS_BY_TYPE[def.type][0] ?? "empty";
            set({
              filters: [
                ...config.filters,
                { field, op, value: defaultValue(def, op) },
              ],
            });
          }}
          className="flex w-fit items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-muted-foreground hover:bg-surface"
        >
          <Plus className="size-3" />
          Filter
        </button>
      </Row>
      <Row label="Sort">
        <div className="flex items-center gap-1">
          <select
            aria-label="Sort field"
            value={config.sort[0]?.field ?? ""}
            onChange={(event) => {
              const field = event.currentTarget.value;
              set({
                sort: field
                  ? [{ field, dir: config.sort[0]?.dir ?? "asc" }]
                  : [],
              });
            }}
            className={SELECT}
          >
            <option value="">
              {descriptor.fields[descriptor.defaultSort.field]?.label ?? "—"}
            </option>
            {fieldEntries.map(([key, def]) => (
              <option key={key} value={key}>
                {def.label}
              </option>
            ))}
          </select>
          {config.sort[0] ? (
            <select
              aria-label="Direction"
              value={config.sort[0].dir}
              onChange={(event) => {
                const first = config.sort[0];
                if (first) {
                  set({
                    sort: [
                      {
                        ...first,
                        dir:
                          event.currentTarget.value === "desc" ? "desc" : "asc",
                      },
                    ],
                  });
                }
              }}
              className={SELECT}
            >
              <option value="asc">↑</option>
              <option value="desc">↓</option>
            </select>
          ) : null}
        </div>
      </Row>
      <Row label="Group">
        <select
          aria-label="Group"
          value={config.group ?? ""}
          onChange={(event) =>
            set({ group: event.currentTarget.value || undefined })
          }
          className={SELECT}
        >
          <option value="">
            {config.layout === "board"
              ? descriptor.defaultGroup
                ? descriptor.fields[descriptor.defaultGroup]?.label
                : "—"
              : "—"}
          </option>
          {groupable.map(([key, def]) => (
            <option key={key} value={key}>
              {def.label}
            </option>
          ))}
        </select>
      </Row>
      {config.layout === "calendar" && dateFields.length > 1 ? (
        <Row label="Date">
          <select
            aria-label="Date field"
            value={viewDateField(descriptor, config) ?? ""}
            onChange={(event) => set({ dateField: event.currentTarget.value })}
            className={SELECT}
          >
            {dateFields.map(([key, def]) => (
              <option key={key} value={key}>
                {def.label}
              </option>
            ))}
          </select>
        </Row>
      ) : null}
      <Row label="Fields">
        <div className="flex flex-wrap gap-1">
          {fieldEntries.map(([key, def]) => {
            const on = shown.includes(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  set({
                    fields: on
                      ? shown.filter((f) => f !== key)
                      : [...shown, key],
                  })
                }
                className={cn(
                  "rounded-sm px-1.5 py-0.5 text-xs",
                  on
                    ? "bg-surface text-accent-strong"
                    : "text-muted-foreground hover:bg-surface/60",
                )}
              >
                {def.label}
              </button>
            );
          })}
        </div>
      </Row>
      <Row label="Rows">
        <input
          type="number"
          aria-label="Rows"
          min={1}
          max={VIEW_LIMIT_MAX}
          value={config.limit}
          onChange={(event) => {
            const n = Math.round(event.currentTarget.valueAsNumber);
            if (Number.isFinite(n))
              set({ limit: Math.min(VIEW_LIMIT_MAX, Math.max(1, n)) });
          }}
          className={cn(INPUT, "max-w-20 flex-none tabular-nums")}
        />
      </Row>
    </div>
  );
}

function changeSource(
  config: ViewConfig,
  source: ViewSourceId,
  onChange: (config: ViewConfig) => void,
) {
  onChange({
    source,
    layout: config.layout,
    filters: [],
    sort: [],
    limit: config.limit,
  });
}
