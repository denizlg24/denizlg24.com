"use client";

import { CalendarIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "./utils";

/**
 * Calendar popover plus a time field over a `yyyy-MM-ddTHH:mm` string — the
 * shape `<input type="datetime-local">` produces, so this is a drop-in for it
 * and the callers' parsing does not move.
 *
 * Same reasoning as {@link ./date-picker}: the native control's picker is the
 * browser's rather than the app's, and it differs per platform. Values are
 * built from local calendar components rather than `Date.parse`, because
 * `new Date("2026-07-30")` is UTC midnight and renders as the 29th anywhere
 * west of Greenwich.
 */

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

function parse(value: string | undefined) {
  if (!value) return undefined;
  const match = PATTERN.exec(value);
  if (!match) return undefined;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function pad(part: number) {
  return `${part}`.padStart(2, "0");
}

function format(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The time half of the value, for the time input. */
function timeOf(value: string | undefined) {
  const match = value ? PATTERN.exec(value) : null;
  return match ? `${match[4]}:${match[5]}` : "";
}

const LABEL_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function DateTimePicker({
  value,
  onValueChange,
  placeholder = "Pick a date",
  /** Time applied when a day is picked on an empty value. */
  defaultTime = "23:59",
  disabled,
  clearable,
  className,
  id,
  "aria-label": ariaLabel,
}: {
  value: string | undefined;
  onValueChange: (value: string | undefined) => void;
  placeholder?: string;
  defaultTime?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parse(value);
  const showClear = Boolean(clearable && selected);

  const setDay = (day: Date | undefined) => {
    if (!day) {
      onValueChange(undefined);
      return;
    }
    // A day click must not silently reset a time already chosen, so the
    // existing one is carried over and `defaultTime` only fills a blank.
    const [hours, minutes] = (timeOf(value) || defaultTime)
      .split(":")
      .map(Number);
    day.setHours(hours ?? 0, minutes ?? 0, 0, 0);
    onValueChange(format(day));
    setOpen(false);
  };

  const setTime = (time: string) => {
    if (!time) return;
    const [hours, minutes] = time.split(":").map(Number);
    const base = selected ?? new Date();
    base.setHours(hours ?? 0, minutes ?? 0, 0, 0);
    onValueChange(format(base));
  };

  return (
    <div className={cn("flex gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        {/*
          The clear control is a sibling of the trigger, not a child: an
          interactive descendant of a <button> is invalid, and as a real button
          it is reachable by keyboard.
        */}
        <div className="relative min-w-0 flex-1">
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              aria-label={ariaLabel}
              disabled={disabled}
              className={cn(
                "w-full justify-start font-normal",
                showClear && "pr-8",
              )}
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
            </Button>
          </PopoverTrigger>
          {showClear && (
            <button
              type="button"
              aria-label="Clear date"
              disabled={disabled}
              onClick={() => onValueChange(undefined)}
              className="absolute inset-y-0 right-1.5 my-auto flex size-5 items-center justify-center rounded-sm opacity-60 outline-none hover:opacity-100 focus-visible:border-ring focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            autoFocus
            selected={selected}
            defaultMonth={selected}
            onSelect={setDay}
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        aria-label={ariaLabel ? `${ariaLabel} time` : "Time"}
        disabled={disabled || !selected}
        value={timeOf(value)}
        onChange={(event) => setTime(event.target.value)}
        className="w-[7.5rem] shrink-0 tabular-nums"
      />
    </div>
  );
}
