"use client";

import { Button } from "@repo/ui/button";
import { SwipeRow } from "@repo/ui/swipe-row";
import { cn } from "@repo/ui/utils";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import type { FlashProps } from "@/hooks/use-flash";
import { formatCalories, formatLoggedAmount } from "@/lib/foods/display";
import { FoodIcon } from "@/lib/foods/food-icon";
import { MACRO_COLORS } from "@/lib/macro-colors";
import type {
  FoodLogDayPayload,
  FoodLogEntry,
} from "@/lib/queries/food-log-day";

export type TimelineMode = "browse" | "select" | "reorder";

type Props = {
  data: FoodLogDayPayload;
  mode: TimelineMode;
  onDeleteEntry: (entryId: string) => void;
  onEditEntry: (entry: FoodLogEntry) => void;
  onRetimeEntry: (entry: FoodLogEntry, hour: number) => void;
  selection: Set<string>;
  onToggleSelection: (entryId: string) => void;
  /** Entries awaiting an undo window; rendered in place of the row. */
  pendingRemoval: Set<string>;
  onUndoRemoval: (entryId: string) => void;
  flashProps: (key: string) => FlashProps;
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

function entryHour(entry: FoodLogEntry, timezone: string): number {
  if (!entry.eatenAt) return 12;
  return toZonedTime(new Date(entry.eatenAt), timezone).getHours();
}

function entryTimeLabel(entry: FoodLogEntry, timezone: string): string {
  if (!entry.eatenAt) return "--:--";
  const zoned = toZonedTime(new Date(entry.eatenAt), timezone);
  return format(zoned, "H:mm");
}

export function Timeline({
  data,
  mode,
  onDeleteEntry,
  onEditEntry,
  onRetimeEntry,
  selection,
  onToggleSelection,
  pendingRemoval,
  onUndoRemoval,
  flashProps,
}: Props) {
  const buckets = useMemo<HourBucket[]>(() => {
    const map = new Map<number, FoodLogEntry[]>();
    for (const entry of data.entries) {
      const hour = entryHour(entry, data.timezone);
      const bucket = map.get(hour) ?? [];
      bucket.push(entry);
      map.set(hour, bucket);
    }
    return [...map.entries()]
      .sort(([left], [right]) => left - right)
      .map(([hour, entries]) => ({
        hour,
        label: hourLabel(hour),
        totals: entries.reduce(
          (acc, entry) => ({
            calories: acc.calories + entry.calories,
            protein: acc.protein + entry.protein,
            fat: acc.fat + entry.fat,
            carbs: acc.carbs + entry.carbs,
          }),
          { calories: 0, protein: 0, fat: 0, carbs: 0 },
        ),
        entries,
      }));
  }, [data.entries, data.timezone]);

  if (buckets.length === 0) {
    return (
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-8">
        <span className="text-3xl leading-none font-light text-muted-foreground">
          —
        </span>
        <Button asChild variant="outline" className="rounded-full px-4">
          <Link href={`/app/add?focus=search&date=${data.date}`}>
            <Plus className="size-4" />
            Add food
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      {buckets.map((bucket) => (
        <section key={bucket.hour}>
          <HourHeading bucket={bucket} date={data.date} />
          {bucket.entries.map((entry) => {
            return pendingRemoval.has(entry.id) ? (
              <RemovedRow
                key={entry.id}
                name={entry.foodName}
                time={entryTimeLabel(entry, data.timezone)}
                onUndo={() => onUndoRemoval(entry.id)}
              />
            ) : (
              <EntryRow
                key={entry.id}
                entry={entry}
                hour={bucket.hour}
                timezone={data.timezone}
                mode={mode}
                selected={selection.has(entry.id)}
                onDelete={onDeleteEntry}
                onEdit={onEditEntry}
                onRetime={onRetimeEntry}
                onToggleSelection={onToggleSelection}
                flashProps={flashProps}
              />
            );
          })}
        </section>
      ))}
    </div>
  );
}

function HourHeading({ bucket, date }: { bucket: HourBucket; date: string }) {
  return (
    <div className="flex items-center gap-3 border-t border-border bg-background/60 px-4 py-1.5">
      <span className="w-11 shrink-0 text-[11px] font-semibold tracking-[0.09em] uppercase text-muted-foreground tabular-nums">
        {bucket.label}
      </span>
      <span className="h-px flex-1 bg-border/60" aria-hidden="true" />
      <span className="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
        <span className="font-semibold text-foreground">
          {formatCalories(bucket.totals.calories)}
        </span>
        <MacroTriple
          protein={bucket.totals.protein}
          fat={bucket.totals.fat}
          carbs={bucket.totals.carbs}
        />
      </span>
      <Link
        href={`/app/add?focus=search&date=${date}&hour=${bucket.hour}`}
        aria-label={`Add food at ${bucket.label}`}
        className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground active:scale-90"
      >
        <Plus className="size-4" />
      </Link>
    </div>
  );
}

function MacroTriple({
  protein,
  fat,
  carbs,
}: {
  protein: number;
  fat: number;
  carbs: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <span>
        {Math.round(protein)}
        <span style={{ color: MACRO_COLORS.protein }}>P</span>
      </span>
      <span>
        {Math.round(fat)}
        <span style={{ color: MACRO_COLORS.fat }}>F</span>
      </span>
      <span>
        {Math.round(carbs)}
        <span style={{ color: MACRO_COLORS.carbs }}>C</span>
      </span>
    </span>
  );
}

function EntryRow({
  entry,
  hour,
  timezone,
  mode,
  selected,
  onDelete,
  onEdit,
  onRetime,
  onToggleSelection,
  flashProps,
}: {
  entry: FoodLogEntry;
  hour: number;
  timezone: string;
  mode: TimelineMode;
  selected: boolean;
  onDelete: (id: string) => void;
  onEdit: (entry: FoodLogEntry) => void;
  onRetime: (entry: FoodLogEntry, hour: number) => void;
  onToggleSelection: (id: string) => void;
  flashProps: (key: string) => FlashProps;
}) {
  const time = entryTimeLabel(entry, timezone);
  const amount = formatLoggedAmount(entry);

  const body = (
    <div
      {...flashProps(entry.id)}
      className={cn(
        "flex items-center gap-3 border-t border-border/40 bg-background px-4 py-2.5",
        selected && "bg-accent/12",
      )}
    >
      {mode === "select" ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${entry.foodName}`}
          onClick={() => onToggleSelection(entry.id)}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center border-2 transition-colors",
            selected
              ? "border-foreground bg-foreground text-background"
              : "border-border text-transparent",
          )}
        >
          <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
            <path
              d="M4 10.5l4 4 8-9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : (
        <span className="w-11 shrink-0 text-[11px] leading-none tabular-nums text-muted-foreground">
          {time}
        </span>
      )}

      <button
        type="button"
        onClick={() =>
          mode === "select" ? onToggleSelection(entry.id) : onEdit(entry)
        }
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <FoodIcon
          name={entry.foodName}
          iconKey={entry.iconKey}
          entryType={entry.entryType}
          className="size-7 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-tight font-medium">
            {entry.foodName}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-tight tabular-nums text-muted-foreground">
            <MacroTriple
              protein={entry.protein}
              fat={entry.fat}
              carbs={entry.carbs}
            />
            <span aria-hidden="true">·</span>
            <span className="truncate">{amount}</span>
          </span>
        </span>
      </button>

      {mode === "reorder" ? (
        <span className="flex shrink-0 items-center">
          <button
            type="button"
            aria-label={`Move ${entry.foodName} an hour earlier`}
            disabled={hour === 0}
            onClick={() => onRetime(entry, hour - 1)}
            className="flex size-9 items-center justify-center text-muted-foreground disabled:opacity-25"
          >
            <ChevronUp className="size-5" />
          </button>
          <button
            type="button"
            aria-label={`Move ${entry.foodName} an hour later`}
            disabled={hour === 23}
            onClick={() => onRetime(entry, hour + 1)}
            className="flex size-9 items-center justify-center text-muted-foreground disabled:opacity-25"
          >
            <ChevronDown className="size-5" />
          </button>
        </span>
      ) : (
        <span className="shrink-0 text-right tabular-nums">
          <span className="block text-[15px] leading-none font-semibold">
            {formatCalories(entry.calories)}
          </span>
          <span className="mt-1 block text-[10px] leading-none text-muted-foreground">
            kcal
          </span>
        </span>
      )}
    </div>
  );

  // Swiping and dragging a row in the same gesture space fight each other, so
  // the swipe-to-delete affordance stands down while rows are being retimed.
  if (mode === "reorder") return body;

  return (
    <SwipeRow
      onAction={() => onDelete(entry.id)}
      action={<Trash2 className="size-4" />}
    >
      {body}
    </SwipeRow>
  );
}

function RemovedRow({
  name,
  time,
  onUndo,
}: {
  name: string;
  time: string;
  onUndo: () => void;
}) {
  return (
    <div
      data-flash="a"
      data-flash-tone="danger"
      className="flex items-center gap-3 border-t border-border/40 px-4 py-2.5"
    >
      <span className="w-11 shrink-0 text-[11px] leading-none tabular-nums text-muted-foreground">
        {time}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] leading-tight text-muted-foreground line-through">
        {name}
      </span>
      <button
        type="button"
        onClick={onUndo}
        className="shrink-0 text-[13px] font-semibold text-foreground underline underline-offset-2"
      >
        Undo
      </button>
    </div>
  );
}
