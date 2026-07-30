"use client";

import { CalendarIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "./utils";

/**
 * Calendar popover over an ISO `yyyy-MM-dd` string — the shape every date in
 * this codebase is stored and transported in. Replaces `<input type="date">`,
 * whose picker is the browser's rather than the app's.
 *
 * Dates are converted through local calendar components, never `Date.parse`:
 * `new Date("2026-07-30")` is UTC midnight, which renders as the 29th anywhere
 * west of Greenwich.
 */

function fromIso(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toIso(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const LABEL_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function DatePicker({
  value,
  onValueChange,
  placeholder = "Pick a date",
  disabled,
  clearable,
  className,
  id,
  "aria-label": ariaLabel,
}: {
  value: string | undefined;
  onValueChange: (value: string | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Show a clear affordance and allow `undefined` (optional end dates). */
  clearable?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = fromIso(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn("w-full justify-start font-normal", className)}
        >
          <CalendarIcon className="size-3.5 shrink-0 opacity-60" />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left tabular-nums",
              !selected && "text-muted-foreground",
            )}
          >
            {selected ? LABEL_FORMAT.format(selected) : placeholder}
          </span>
          {clearable && selected && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear date"
              className="-mr-1 shrink-0 rounded-sm p-0.5 opacity-60 hover:opacity-100"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onValueChange(undefined);
              }}
            >
              <XIcon className="size-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          autoFocus
          selected={selected}
          defaultMonth={selected}
          onSelect={(next) => {
            onValueChange(next ? toIso(next) : undefined);
            if (next) setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export { fromIso as isoToDate, toIso as dateToIso };
