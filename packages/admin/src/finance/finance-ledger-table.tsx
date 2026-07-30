"use client";

import type {
  FinanceAccount,
  FinanceCategory,
  FinanceLedgerEntry,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { DatePicker } from "@repo/ui/date-picker";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { cn } from "@repo/ui/utils";
import { minorToMajor } from "@repo/utils";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { money, shortDay } from "./finance-series";

/**
 * The ledger table.
 *
 * Purpose-built rather than the shared `DataTable`: that one wraps itself in a
 * card border with a boxed search field, and cannot express the faceted filters
 * this view needs. Layout here is hairlines and dense rows, matching the rest
 * of the finance surfaces.
 */

type SortKey = "effectiveDate" | "descriptor" | "category" | "amountMinor";
type SortDirection = "asc" | "desc";

const PAGE_SIZE = 60;

export interface LedgerFilters {
  search: string;
  accountId: string;
  kind: string;
  direction: string;
  category: string;
  from: string | undefined;
  to: string | undefined;
  minAmount: string;
  maxAmount: string;
}

const EMPTY_FILTERS: LedgerFilters = {
  search: "",
  accountId: "all",
  kind: "all",
  direction: "all",
  category: "all",
  from: undefined,
  to: undefined,
  minAmount: "",
  maxAmount: "",
};

function entryKind(entry: FinanceLedgerEntry) {
  if (entry.origin === "bank") {
    return entry.state === "pending" ? "pending" : "bank";
  }
  if (entry.origin === "manual") return "manual";
  return entry.recurringRuleId ? "recurring" : "expected";
}

const KIND_LABEL: Record<string, string> = {
  bank: "Bank",
  pending: "Pending",
  manual: "Manual",
  recurring: "Recurring",
  expected: "Expected",
};

function SortButton({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; direction: SortDirection };
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "flex items-center gap-1 transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {label}
      {active ? (
        sort.direction === "asc" ? (
          <ArrowUp className="size-3" />
        ) : (
          <ArrowDown className="size-3" />
        )
      ) : (
        <ArrowUpDown className="size-3 opacity-30" />
      )}
    </button>
  );
}

export function FinanceLedgerTable({
  entries,
  accounts,
  categories,
  onSelect,
}: {
  entries: FinanceLedgerEntry[];
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onSelect: (entry: FinanceLedgerEntry) => void;
}) {
  const [filters, setFilters] = useState<LedgerFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [sort, setSort] = useState<{
    key: SortKey;
    direction: SortDirection;
  }>({ key: "effectiveDate", direction: "desc" });

  const accountsById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );

  const categoryNames = useMemo(() => {
    const names = new Set(categories.map((category) => category.name));
    for (const entry of entries) {
      if (entry.category) names.add(entry.category);
    }
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [categories, entries]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.accountId !== "all") count += 1;
    if (filters.kind !== "all") count += 1;
    if (filters.direction !== "all") count += 1;
    if (filters.category !== "all") count += 1;
    if (filters.from) count += 1;
    if (filters.to) count += 1;
    if (filters.minAmount) count += 1;
    if (filters.maxAmount) count += 1;
    return count;
  }, [filters]);

  const rows = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const min = filters.minAmount ? Number(filters.minAmount) : undefined;
    const max = filters.maxAmount ? Number(filters.maxAmount) : undefined;

    const filtered = entries.filter((entry) => {
      if (
        filters.accountId !== "all" &&
        entry.accountId !== filters.accountId
      ) {
        return false;
      }
      if (filters.kind !== "all" && entryKind(entry) !== filters.kind) {
        return false;
      }
      if (filters.direction === "expense" && entry.amountMinor >= 0) {
        return false;
      }
      if (filters.direction === "income" && entry.amountMinor <= 0) {
        return false;
      }
      if (filters.category === "none" && entry.category) return false;
      if (
        filters.category !== "all" &&
        filters.category !== "none" &&
        entry.category !== filters.category
      ) {
        return false;
      }
      if (filters.from && entry.effectiveDate < filters.from) return false;
      if (filters.to && entry.effectiveDate > filters.to) return false;

      const magnitude = Math.abs(
        minorToMajor(entry.amountMinor, entry.currency),
      );
      if (min !== undefined && Number.isFinite(min) && magnitude < min) {
        return false;
      }
      if (max !== undefined && Number.isFinite(max) && magnitude > max) {
        return false;
      }
      if (search) {
        const haystack = [
          entry.descriptor,
          entry.category ?? "",
          accountsById.get(entry.accountId)?.displayName ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    const factor = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      if (sort.key === "amountMinor") {
        return (left.amountMinor - right.amountMinor) * factor;
      }
      if (sort.key === "category") {
        return (
          (left.category ?? "").localeCompare(right.category ?? "") * factor
        );
      }
      if (sort.key === "descriptor") {
        return left.descriptor.localeCompare(right.descriptor) * factor;
      }
      return left.effectiveDate.localeCompare(right.effectiveDate) * factor;
    });
  }, [entries, filters, sort, accountsById]);

  const totals = useMemo(() => {
    let spend = 0;
    let income = 0;
    for (const row of rows) {
      if (row.amountMinor < 0) spend += Math.abs(row.amountMinor);
      else income += row.amountMinor;
    }
    return { spend, income };
  }, [rows]);

  const currency = rows[0]?.currency ?? accounts[0]?.currency ?? "EUR";

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "descriptor" ? "asc" : "desc" },
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-0 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filters.search}
            onChange={(event) => {
              setFilters((current) => ({
                ...current,
                search: event.target.value,
              }));
              setVisible(PAGE_SIZE);
            }}
            placeholder="Search ledger"
            aria-label="Search ledger"
            className="h-8 w-full border-0 border-b border-border bg-transparent pl-5 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground"
          />
        </div>
        <Button
          size="xs"
          variant={showFilters || activeFilterCount > 0 ? "secondary" : "ghost"}
          onClick={() => setShowFilters((open) => !open)}
        >
          <SlidersHorizontal className="size-3" />
          Filters
          {activeFilterCount > 0 && (
            <span className="tabular-nums">{activeFilterCount}</span>
          )}
        </Button>
        {activeFilterCount > 0 && (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Clear filters"
            onClick={() =>
              setFilters({ ...EMPTY_FILTERS, search: filters.search })
            }
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {showFilters && (
        <div className="grid gap-2 border-b pb-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            value={filters.accountId}
            onValueChange={(value) =>
              setFilters((current) => ({ ...current, accountId: value }))
            }
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.kind}
            onValueChange={(value) =>
              setFilters((current) => ({ ...current, kind: value }))
            }
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {Object.entries(KIND_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.direction}
            onValueChange={(value) =>
              setFilters((current) => ({ ...current, direction: value }))
            }
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Direction" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">In and out</SelectItem>
              <SelectItem value="expense">Out</SelectItem>
              <SelectItem value="income">In</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filters.category}
            onValueChange={(value) =>
              setFilters((current) => ({ ...current, category: value }))
            }
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="none">Uncategorized</SelectItem>
              {categoryNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DatePicker
            clearable
            value={filters.from}
            onValueChange={(value) =>
              setFilters((current) => ({ ...current, from: value }))
            }
            placeholder="From"
            aria-label="From date"
            className="h-8 text-xs"
          />
          <DatePicker
            clearable
            value={filters.to}
            onValueChange={(value) =>
              setFilters((current) => ({ ...current, to: value }))
            }
            placeholder="To"
            aria-label="To date"
            className="h-8 text-xs"
          />
          <Input
            value={filters.minAmount}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                minAmount: event.target.value,
              }))
            }
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="Min amount"
            aria-label="Minimum amount"
            className="h-8 tabular-nums"
          />
          <Input
            value={filters.maxAmount}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                maxAmount: event.target.value,
              }))
            }
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="Max amount"
            aria-label="Maximum amount"
            className="h-8 tabular-nums"
          />
        </div>
      )}

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b text-[10px] font-medium uppercase tracking-[0.14em]">
              <th className="py-1.5 pr-3 text-left font-medium">
                <SortButton
                  label="Date"
                  sortKey="effectiveDate"
                  sort={sort}
                  onSort={toggleSort}
                />
              </th>
              <th className="py-1.5 pr-3 text-left font-medium">
                <SortButton
                  label="Transaction"
                  sortKey="descriptor"
                  sort={sort}
                  onSort={toggleSort}
                />
              </th>
              <th className="hidden py-1.5 pr-3 text-left font-medium md:table-cell">
                <SortButton
                  label="Category"
                  sortKey="category"
                  sort={sort}
                  onSort={toggleSort}
                />
              </th>
              <th className="hidden py-1.5 pr-3 text-left font-medium lg:table-cell">
                <span className="text-muted-foreground">Account</span>
              </th>
              <th className="py-1.5 text-right font-medium">
                <SortButton
                  label="Amount"
                  sortKey="amountMinor"
                  sort={sort}
                  onSort={toggleSort}
                  className="ml-auto"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, visible).map((entry) => {
              const kind = entryKind(entry);
              return (
                <tr
                  key={entry.id}
                  tabIndex={0}
                  onClick={() => onSelect(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(entry);
                    }
                  }}
                  className="cursor-pointer border-b border-border/60 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
                >
                  <td className="py-1.5 pr-3 align-top whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                    {shortDay(entry.effectiveDate)}
                  </td>
                  <td className="max-w-0 py-1.5 pr-3 align-top">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "min-w-0 truncate",
                          entry.origin === "projected" &&
                            "text-muted-foreground",
                        )}
                      >
                        {entry.descriptor}
                      </span>
                      {kind !== "bank" && (
                        <Badge
                          variant={
                            kind === "expected" || kind === "pending"
                              ? "outline"
                              : "secondary"
                          }
                          className="h-4 shrink-0 px-1 text-[9px]"
                        >
                          {KIND_LABEL[kind]}
                        </Badge>
                      )}
                      {entry.transferId && (
                        <Badge
                          variant="secondary"
                          className="h-4 shrink-0 px-1 text-[9px]"
                        >
                          transfer
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground md:hidden">
                      {entry.category ?? "—"}
                    </div>
                  </td>
                  <td className="hidden max-w-0 py-1.5 pr-3 align-top md:table-cell">
                    <span
                      className={cn(
                        "block truncate text-xs",
                        entry.category
                          ? "text-muted-foreground"
                          : "text-muted-foreground/50",
                      )}
                    >
                      {entry.category ?? "—"}
                    </span>
                  </td>
                  <td className="hidden max-w-0 py-1.5 pr-3 align-top lg:table-cell">
                    <span className="block truncate text-xs text-muted-foreground">
                      {accountsById.get(entry.accountId)?.displayName ?? "—"}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "py-1.5 text-right align-top whitespace-nowrap font-medium tabular-nums",
                      entry.amountMinor > 0 && "text-status-good",
                      entry.origin === "projected" && "text-muted-foreground",
                    )}
                  >
                    {money(entry.amountMinor, entry.currency)}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="py-10 text-center text-xs text-muted-foreground"
                >
                  No entries
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
        <span>
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
        <span>out {money(-totals.spend, currency)}</span>
        <span>in {money(totals.income, currency)}</span>
        <span className="text-foreground">
          net {money(totals.income - totals.spend, currency)}
        </span>
        {visible < rows.length && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            onClick={() => setVisible((count) => count + PAGE_SIZE)}
          >
            Show {Math.min(PAGE_SIZE, rows.length - visible)} more
          </Button>
        )}
      </div>
    </div>
  );
}
