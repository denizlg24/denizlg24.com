"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  ArrowUpRight as External,
  CircleAlert,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableHead } from "@/components/ui/table";
import { amount, cn, percent, tone } from "@/lib/utils";

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(
      data.error ?? "The request could not be completed.",
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return data as T;
}

export function Change({
  value,
  arrows = false,
}: {
  value: number | null | undefined;
  arrows?: boolean;
}) {
  const Icon = value != null && value < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <span className={`change ${tone(value)}`}>
      {arrows && value ? <Icon size={14} aria-hidden /> : null}
      {percent(value)}
    </span>
  );
}

export function PanelHeading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function Empty({
  children,
  title,
}: {
  children?: ReactNode;
  title: string;
}) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

export function Loading({
  message = "Loading market data",
}: {
  message?: string;
}) {
  return (
    <div className="loading-box" role="status">
      <span className="skeleton" />
      <span className="skeleton" />
      <span className="skeleton" />
      <span className="sr-only">{message}</span>
    </div>
  );
}

export function Failure({
  error,
  retry,
}: {
  error: Error | undefined;
  retry?: () => unknown;
}) {
  if (!error) return null;
  return (
    <div className="failure" role="alert">
      <CircleAlert size={16} />
      <span>{error.message}</span>
      {retry ? (
        <Button variant="ghost" size="sm" onClick={() => void retry()}>
          <RefreshCw /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function SourceLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a className="source-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <External size={13} aria-hidden />
    </a>
  );
}

export const signed = (value: number | null | undefined) =>
  value == null ? "—" : `${value > 0 ? "+" : ""}${amount(value)}`;

const clockFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const dayClockFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function quoteTime(time: number | null | undefined) {
  if (time == null) return "—";
  const date = new Date(time * 1000);
  return date.toDateString() === new Date().toDateString()
    ? clockFormat.format(date)
    : dayClockFormat.format(date);
}

export function Signed({
  value,
  children,
}: {
  value: number | null | undefined;
  children?: ReactNode;
}) {
  return <span className={tone(value)}>{children ?? signed(value)}</span>;
}

export function SymbolLink({
  symbol,
  select,
  label,
}: {
  symbol: string;
  select: (symbol: string) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="sym-link"
      title={label ? `${label} · open chart` : "Open chart"}
      onClick={() => select(symbol)}
    >
      {symbol}
    </button>
  );
}

export function SectionFoot({ children }: { children: ReactNode }) {
  return <footer className="section-foot">{children}</footer>;
}

type SortValue = number | string | null | undefined;
export type SortDirection = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDirection };

export function useSort<T, K extends string>(
  rows: T[],
  accessors: Record<K, (row: T) => SortValue>,
  initial: SortState<NoInfer<K>>,
) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => {
    const read = accessors[sort.key];
    const factor = sort.dir === "asc" ? 1 : -1;
    return rows.toSorted((a, b) => {
      const left = read(a);
      const right = read(b);
      if (left == null || right == null)
        return left == null ? (right == null ? 0 : 1) : -1;
      if (typeof left === "number" && typeof right === "number")
        return (left - right) * factor;
      return String(left).localeCompare(String(right)) * factor;
    });
  }, [rows, accessors, sort]);
  const toggle = (key: K) =>
    setSort((current) => {
      if (current.key === key)
        return { key, dir: current.dir === "asc" ? "desc" : "asc" };
      const sample = rows.map(accessors[key]).find((item) => item != null);
      return { key, dir: typeof sample === "string" ? "asc" : "desc" };
    });
  return { sorted, sort, toggle };
}

export function SortHead<K extends string>({
  label,
  column,
  sort,
  toggle,
  numeric = false,
  className,
}: {
  label: string;
  column: NoInfer<K>;
  sort: SortState<K>;
  toggle: (column: K) => void;
  numeric?: boolean;
  className?: string;
}) {
  const active = sort.key === column;
  const Icon = sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined
      }
      className={cn(numeric && "text-right", className)}
    >
      <button
        type="button"
        className="sort-head"
        data-active={active || undefined}
        onClick={() => toggle(column)}
      >
        {label}
        <Icon aria-hidden />
      </button>
    </TableHead>
  );
}
