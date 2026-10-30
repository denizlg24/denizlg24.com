"use client";

import {
  type ViewConfig,
  type ViewQueryResult,
  type ViewRow,
  type ViewSourceDescriptor,
  viewDateField,
  viewGroupField,
} from "@repo/schemas";
import { cn } from "@repo/ui/utils";
import { valueKeys } from "@repo/utils/workspace-views";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { RecordCard } from "../record-embed";
import { useRecord } from "../records";
import { formatTotals, formatValue, groupLabel } from "./format";

const LABEL =
  "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

export interface LayoutProps {
  descriptor: ViewSourceDescriptor;
  config: ViewConfig;
  result: ViewQueryResult;
  rows: ViewRow[];
  /** Visible fields, title first. */
  fields: string[];
  rowHref: (row: ViewRow) => string | undefined;
}

function RowLink({
  href,
  className,
  children,
}: {
  href: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

function titleOf(descriptor: ViewSourceDescriptor, row: ViewRow): string {
  return (
    formatValue(
      descriptor.fields[descriptor.titleField],
      row.values[descriptor.titleField],
    ) || "Untitled"
  );
}

/** Rows bucketed by the view's group field, in the order the server gave the groups. */
function bucket(
  props: Pick<LayoutProps, "descriptor" | "config" | "result" | "rows">,
  field: string,
): {
  key: string;
  count: number;
  totals: ViewQueryResult["totals"];
  rows: ViewRow[];
}[] {
  const order = props.result.groups.map((group) => group.key);
  const map = new Map<string, ViewRow[]>(order.map((key) => [key, []]));
  for (const row of props.rows) {
    const keys = valueKeys(row.values[field]);
    for (const key of keys.length > 0 ? keys : [""]) {
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
  }
  return [...map].map(([key, rows]) => {
    const group = props.result.groups.find((g) => g.key === key);
    return {
      key,
      count: group?.count ?? rows.length,
      totals: group?.totals ?? [],
      rows,
    };
  });
}

function Totals({
  totals,
  field,
}: {
  totals: ViewQueryResult["totals"];
  field: string;
}) {
  const lines = formatTotals(totals, field);
  if (lines.length === 0) return null;
  return (
    <span data-totals={field} className="flex flex-col items-end tabular-nums">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}

function moneyFields(
  props: Pick<LayoutProps, "descriptor" | "fields">,
): string[] {
  return props.fields.filter(
    (f) => props.descriptor.fields[f]?.type === "money",
  );
}

// --- table ------------------------------------------------------------------

export function TableLayout(props: LayoutProps) {
  const { descriptor, fields, rowHref, result } = props;
  const group = props.config.group
    ? viewGroupField(descriptor, props.config)
    : null;
  const money = moneyFields(props);
  const sections = group
    ? bucket(props, group)
    : [
        {
          key: "",
          count: result.total,
          totals: result.totals,
          rows: props.rows,
        },
      ];
  const renderRow = (row: ViewRow, key: string) => (
    <tr
      key={`${key}:${row.id}`}
      data-row={row.id}
      className="border-b hover:bg-surface/70"
    >
      {fields.map((field, index) => {
        const def = descriptor.fields[field];
        const text = formatValue(def, row.values[field]);
        const numeric = def?.type === "money" || def?.type === "number";
        return (
          <td
            key={field}
            className={cn(
              "px-2 py-1.5 align-top",
              numeric && "text-right tabular-nums",
              index > 0 && "text-muted-foreground",
            )}
          >
            {index === 0 ? (
              <RowLink
                href={rowHref(row)}
                className="text-accent-strong hover:underline"
              >
                {text || "Untitled"}
              </RowLink>
            ) : (
              text
            )}
          </td>
        );
      })}
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table data-layout="table" className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b">
            {fields.map((field) => {
              const def = descriptor.fields[field];
              const numeric = def?.type === "money" || def?.type === "number";
              return (
                <th
                  key={field}
                  className={cn(
                    LABEL,
                    "px-2 py-1.5 font-medium",
                    numeric ? "text-right" : "text-left",
                  )}
                >
                  {def?.label ?? field}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) =>
            group
              ? [
                  <tr key={`group:${section.key}`} data-group={section.key}>
                    <td colSpan={fields.length} className="px-2 pt-3 pb-1">
                      <span className="flex items-baseline gap-2">
                        <span className={LABEL}>
                          {groupLabel(descriptor.fields[group], section.key)}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {section.count}
                        </span>
                        {money.map((field) => (
                          <span
                            key={field}
                            className="ml-auto text-xs text-muted-foreground"
                          >
                            <Totals totals={section.totals} field={field} />
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>,
                  ...section.rows.map((row) => renderRow(row, section.key)),
                ]
              : section.rows.map((row) => renderRow(row, "")),
          )}
        </tbody>
        {money.length > 0 && result.totals.length > 0 ? (
          <tfoot>
            <tr>
              {fields.map((field) => (
                <td
                  key={field}
                  className="px-2 py-1.5 text-right text-xs text-muted-foreground"
                >
                  {money.includes(field) ? (
                    <Totals totals={result.totals} field={field} />
                  ) : null}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

// --- list -------------------------------------------------------------------

export function ListLayout(props: LayoutProps) {
  const { descriptor, fields, rowHref } = props;
  const secondary = fields.filter((f) => f !== descriptor.titleField);
  return (
    <div data-layout="list" className="flex flex-col">
      {props.rows.map((row) => (
        <RowLink
          key={row.id}
          href={rowHref(row)}
          className="flex items-baseline gap-3 border-b py-1.5 text-sm hover:bg-surface/70"
        >
          <span
            data-row={row.id}
            className="min-w-0 truncate text-accent-strong"
          >
            {titleOf(descriptor, row)}
          </span>
          <span className="ml-auto flex shrink-0 gap-3 text-xs text-muted-foreground tabular-nums">
            {secondary.map((field) => {
              const text = formatValue(
                descriptor.fields[field],
                row.values[field],
              );
              return text ? <span key={field}>{text}</span> : null;
            })}
          </span>
        </RowLink>
      ))}
    </div>
  );
}

// --- board ------------------------------------------------------------------

export function BoardLayout(props: LayoutProps) {
  const { descriptor, fields, rowHref } = props;
  const group = viewGroupField(descriptor, props.config);
  if (!group) return <ListLayout {...props} />;
  const money = moneyFields(props);
  const secondary = fields.filter(
    (f) => f !== descriptor.titleField && f !== group,
  );
  return (
    <div data-layout="board" className="flex gap-6 overflow-x-auto pb-2">
      {bucket(props, group).map((column) => (
        <div
          key={column.key}
          data-group={column.key}
          className="flex w-60 shrink-0 flex-col gap-1"
        >
          <div className="flex items-baseline gap-2 border-b pb-1">
            <span className={LABEL}>
              {groupLabel(descriptor.fields[group], column.key)}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {column.count}
            </span>
            {money.map((field) => (
              <span
                key={field}
                className="ml-auto text-xs text-muted-foreground"
              >
                <Totals totals={column.totals} field={field} />
              </span>
            ))}
          </div>
          {column.rows.map((row) => (
            <RowLink
              key={row.id}
              href={rowHref(row)}
              className="flex flex-col gap-0.5 rounded-sm px-1 py-1.5 hover:bg-surface"
            >
              <span data-row={row.id} className="text-sm text-accent-strong">
                {titleOf(descriptor, row)}
              </span>
              {secondary.map((field) => {
                const text = formatValue(
                  descriptor.fields[field],
                  row.values[field],
                );
                return text ? (
                  <span
                    key={field}
                    className="text-xs text-muted-foreground tabular-nums"
                  >
                    {text}
                  </span>
                ) : null;
              })}
            </RowLink>
          ))}
        </div>
      ))}
    </div>
  );
}

// --- calendar ---------------------------------------------------------------

/** The month a calendar view shows and the day window its query asks for. */
export function monthWindow(month: Date): { from: string; to: string } {
  return {
    from: format(
      startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
      "yyyy-MM-dd",
    ),
    to: format(endOfWeek(endOfMonth(month), { weekStartsOn: 1 }), "yyyy-MM-dd"),
  };
}

export function CalendarLayout(
  props: LayoutProps & { month: Date; onMonth: (month: Date) => void },
) {
  const { descriptor, rowHref, month } = props;
  const field = viewDateField(descriptor, props.config);
  if (!field) return <ListLayout {...props} />;
  const byDay = new Map<string, ViewRow[]>();
  for (const row of props.rows) {
    const value = row.values[field];
    if (typeof value !== "string" || value.length < 10) continue;
    const day =
      value.length === 10 ? value : format(parseISO(value), "yyyy-MM-dd");
    byDay.set(day, [...(byDay.get(day) ?? []), row]);
  }
  const { from, to } = monthWindow(month);
  const days: Date[] = [];
  for (
    let d = parseISO(from);
    format(d, "yyyy-MM-dd") <= to;
    d = addDays(d, 1)
  ) {
    days.push(d);
  }
  const today = format(new Date(), "yyyy-MM-dd");
  return (
    <div data-layout="calendar" className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => props.onMonth(addMonths(month, -1))}
          className="rounded p-0.5 text-muted-foreground hover:bg-surface"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-28 text-center text-sm font-medium text-accent-strong">
          {format(month, "MMMM yyyy")}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => props.onMonth(addMonths(month, 1))}
          className="rounded p-0.5 text-muted-foreground hover:bg-surface"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 border-t border-l text-xs">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => (
          <div
            key={name}
            className={cn(LABEL, "border-r border-b px-1.5 py-1")}
          >
            {name}
          </div>
        ))}
        {days.map((date) => {
          const key = format(date, "yyyy-MM-dd");
          const rows = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              data-day={key}
              className={cn(
                "flex min-h-20 flex-col gap-0.5 border-r border-b p-1",
                !isSameMonth(date, month) &&
                  "bg-surface/40 text-muted-foreground/60",
              )}
            >
              <span
                className={cn(
                  "tabular-nums text-muted-foreground",
                  key === today && "font-semibold text-accent-strong",
                )}
              >
                {format(date, "d")}
              </span>
              {rows.slice(0, 3).map((row) => (
                <RowLink
                  key={row.id}
                  href={rowHref(row)}
                  className="truncate rounded-sm px-1 text-accent-strong hover:bg-surface"
                >
                  <span data-row={row.id}>{titleOf(descriptor, row)}</span>
                </RowLink>
              ))}
              {rows.length > 3 ? (
                <span className="px-1 text-muted-foreground">
                  +{rows.length - 3}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- gallery ----------------------------------------------------------------

function GalleryRecord({
  row,
  fallback,
}: {
  row: ViewRow;
  fallback: ReactNode;
}) {
  const state = useRecord(row.ref);
  return state.status === "ready" ? (
    <RecordCard record={state.record} />
  ) : (
    fallback
  );
}

export function GalleryLayout(props: LayoutProps) {
  const { descriptor, fields, rowHref } = props;
  const secondary = fields.filter((f) => f !== descriptor.titleField);
  return (
    <div
      data-layout="gallery"
      className="grid grid-cols-1 gap-x-6 @xl:grid-cols-2 @3xl:grid-cols-3"
    >
      {props.rows.map((row) => {
        const tile = (
          <RowLink
            href={rowHref(row)}
            className="flex flex-col gap-0.5 border-b py-2 hover:bg-surface/70"
          >
            <span
              data-row={row.id}
              className="text-sm font-medium text-accent-strong"
            >
              {titleOf(descriptor, row)}
            </span>
            {secondary.slice(0, 3).map((field) => {
              const text = formatValue(
                descriptor.fields[field],
                row.values[field],
              );
              return text ? (
                <span
                  key={field}
                  className="text-xs text-muted-foreground tabular-nums"
                >
                  {text}
                </span>
              ) : null;
            })}
          </RowLink>
        );
        return (
          <div key={row.id} data-tile={row.id}>
            {row.ref ? <GalleryRecord row={row} fallback={tile} /> : tile}
          </div>
        );
      })}
    </div>
  );
}
