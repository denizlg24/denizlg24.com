"use client";

import { Button } from "@repo/ui/button";
import { SwipeRow } from "@repo/ui/swipe-row";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Flame, Pencil, Plus, Trash2, Utensils } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { formatCalories, formatLoggedAmount } from "@/lib/foods/display";
import { FoodIcon } from "@/lib/foods/food-icon";
import type {
  FoodLogDayPayload,
  FoodLogEntry,
} from "@/lib/queries/food-log-day";

type Props = {
  data: FoodLogDayPayload;
  onDeleteEntry: (entryId: string) => void;
  onEditEntry: (entry: FoodLogEntry) => void;
  selection?: Set<string>;
  onToggleSelection?: (entryId: string) => void;
};

type HourBucket = {
  hour: number;
  label: string;
  totals: { calories: number; protein: number; fat: number; carbs: number };
  entries: FoodLogEntry[];
};

function hourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function entryHour(e: FoodLogEntry, timezone: string): number {
  if (!e.eatenAt) return 12;
  const zonedDate = toZonedTime(new Date(e.eatenAt), timezone);
  return zonedDate.getHours();
}

function entryTimeLabel(e: FoodLogEntry, timezone: string): string {
  if (!e.eatenAt) return "";
  const zonedDate = toZonedTime(new Date(e.eatenAt), timezone);
  zonedDate.setMinutes(Math.floor(zonedDate.getMinutes() / 15) * 15, 0, 0);
  return format(zonedDate, "h:mm");
}

export function Timeline({
  data,
  onDeleteEntry,
  onEditEntry,
  selection,
  onToggleSelection,
}: Props) {
  const buckets = useMemo<HourBucket[]>(() => {
    const map = new Map<number, FoodLogEntry[]>();
    for (const e of data.entries) {
      const h = entryHour(e, data.timezone);
      const arr = map.get(h) ?? [];
      arr.push(e);
      map.set(h, arr);
    }
    return Array.from({ length: 24 }, (_, hour) => {
      const entries = map.get(hour) ?? [];
      const totals = entries.reduce(
        (acc, e) => ({
          calories: acc.calories + e.calories,
          protein: acc.protein + e.protein,
          fat: acc.fat + e.fat,
          carbs: acc.carbs + e.carbs,
        }),
        { calories: 0, protein: 0, fat: 0, carbs: 0 },
      );
      return { hour, label: hourLabel(hour), totals, entries };
    });
  }, [data.entries, data.timezone]);

  const visibleBuckets = buckets.filter((bucket) => bucket.entries.length > 0);

  if (visibleBuckets.length === 0) {
    return (
      <div className="px-5 py-14 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-card text-muted-foreground">
          <Utensils aria-hidden="true" className="size-7" strokeWidth={1.8} />
        </span>
        <h2 className="mt-4 text-lg font-semibold">Nothing logged yet</h2>
        <p className="mx-auto mt-1 max-w-64 text-sm leading-relaxed text-muted-foreground">
          Add your first food to start tracking today&apos;s nutrition.
        </p>
        <Button asChild className="mt-5 rounded-full px-5">
          <Link href={`/app/add?focus=search&date=${data.date}`}>
            <Plus className="size-4" />
            Add food
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative px-3 pt-3 pb-7">
      <div className="absolute top-3 bottom-7 left-9 w-px bg-border/80" />
      {visibleBuckets.map((b) => (
        <HourRow
          key={b.hour}
          bucket={b}
          date={data.date}
          timezone={data.timezone}
          onDeleteEntry={onDeleteEntry}
          onEditEntry={onEditEntry}
          selection={selection}
          onToggleSelection={onToggleSelection}
        />
      ))}
    </div>
  );
}

function HourRow({
  bucket,
  date,
  timezone,
  onDeleteEntry,
  onEditEntry,
  selection,
  onToggleSelection,
}: {
  bucket: HourBucket;
  date: string;
  timezone: string;
  onDeleteEntry: (entryId: string) => void;
  onEditEntry: (entry: FoodLogEntry) => void;
  selection?: Set<string>;
  onToggleSelection?: (entryId: string) => void;
}) {
  return (
    <section className="relative pb-2">
      <div className="relative flex min-h-12 items-center gap-3 pl-14 pr-1">
        <span className="absolute top-1/2 left-6 inline-flex h-7 min-w-13 -translate-x-1/2 -translate-y-1/2 items-center justify-center whitespace-nowrap rounded-full bg-muted px-2 text-xs font-medium tabular-nums text-foreground">
          {bucket.label}
        </span>
        <Link
          href={`/app/add?focus=search&date=${date}&hour=${bucket.hour}`}
          aria-label={`Add food at ${bucket.label}`}
          className="inline-flex size-8 items-center justify-center rounded-full bg-card text-foreground active:scale-95"
        >
          <Plus className="size-5" />
        </Link>
        <div className="ml-auto flex items-center gap-2.5 text-xs tabular-nums text-foreground">
          <MacroPill
            value={formatCalories(bucket.totals.calories)}
            suffix={<Flame className="size-3" />}
          />
          <MacroPill
            value={Math.round(bucket.totals.protein)}
            suffix={<span className="text-[10px] font-semibold">P</span>}
          />
          <MacroPill
            value={Math.round(bucket.totals.fat)}
            suffix={<span className="text-[10px] font-semibold">F</span>}
          />
          <MacroPill
            value={Math.round(bucket.totals.carbs)}
            suffix={<span className="text-[10px] font-semibold">C</span>}
          />
        </div>
      </div>

      {bucket.entries.map((e) => (
        <EntryCard
          key={e.id}
          entry={e}
          timezone={timezone}
          onDelete={onDeleteEntry}
          onEdit={onEditEntry}
          selected={selection?.has(e.id) ?? false}
          onToggleSelection={onToggleSelection}
        />
      ))}
    </section>
  );
}

function MacroPill({
  value,
  suffix,
}: {
  value: string | number;
  suffix: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span>{value}</span>
      <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {suffix}
      </span>
    </span>
  );
}

function EntryCard({
  entry,
  timezone,
  onDelete,
  onEdit,
  selected,
  onToggleSelection,
}: {
  entry: FoodLogEntry;
  timezone: string;
  onDelete: (id: string) => void;
  onEdit: (entry: FoodLogEntry) => void;
  selected: boolean;
  onToggleSelection?: (id: string) => void;
}) {
  const time = entryTimeLabel(entry, timezone);
  const amount = formatLoggedAmount(entry);

  return (
    <div className="relative pb-2 pl-14 pr-1">
      {time ? (
        <span className="absolute top-4 left-6 -translate-x-1/2 rounded-full bg-background px-1.5 py-0.5 text-[11px] leading-none tabular-nums text-muted-foreground">
          {time}
        </span>
      ) : null}
      <SwipeRow
        className="rounded-2xl"
        onAction={() => onDelete(entry.id)}
        action={<Trash2 className="size-4" />}
      >
        <div className="rounded-2xl bg-card px-3 py-3">
          <div className="flex min-h-15 items-center gap-3">
            {onToggleSelection ? (
              <input
                type="checkbox"
                checked={selected}
                aria-label={`Select ${entry.foodName}`}
                className="size-5 shrink-0 accent-primary"
                onChange={() => onToggleSelection(entry.id)}
              />
            ) : null}
            <span className="flex size-10 shrink-0 items-center justify-center text-muted-foreground">
              <FoodIcon
                name={entry.foodName}
                iconKey={entry.iconKey}
                entryType={entry.entryType}
                className="size-7"
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-base font-medium leading-snug">
                {entry.foodName}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] leading-tight tabular-nums text-muted-foreground">
                <span className="inline-flex items-center font-medium">
                  {formatCalories(entry.calories)}
                  <Flame className="ml-0.5 size-3" />
                </span>
                <span>{Math.round(entry.protein)}P</span>
                <span>{Math.round(entry.fat)}F</span>
                <span>{Math.round(entry.carbs)}C</span>
                <span aria-hidden="true">•</span>
                <span>{amount}</span>
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Edit ${entry.foodName}`}
              onClick={() => onEdit(entry)}
              className="size-10 shrink-0 rounded-full bg-muted text-foreground"
            >
              <Pencil className="size-4" />
            </Button>
          </div>
        </div>
      </SwipeRow>
    </div>
  );
}
