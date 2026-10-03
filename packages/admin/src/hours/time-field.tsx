"use client";

import { cn } from "@repo/ui/utils";
import { Minus, Plus, X } from "lucide-react";
import { useRef } from "react";

const DAY = 24 * 60;

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function fromMinutes(total: number) {
  const wrapped = ((total % DAY) + DAY) % DAY;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** Moves to the next step boundary in `direction`, so 09:17 − 15 is 09:15,
 *  not 09:02: a step corrects a time onto the grid before it travels. */
export function stepTime(value: string, step: number, direction: 1 | -1) {
  const minutes = toMinutes(value);
  const remainder = ((minutes % step) + step) % step;
  if (remainder === 0) return fromMinutes(minutes + direction * step);
  return fromMinutes(
    direction === 1 ? minutes + (step - remainder) : minutes - remainder,
  );
}

/**
 * A wall-clock time as a large readout between −/+ steppers. The readout is a
 * transparent native `<input type="time">` laid over the text, so a tap opens
 * the platform's own picker (the wheel on iOS) for an exact time while the
 * steppers cover the usual "a quarter later" correction. The input never
 * renders itself: iOS sizes time inputs by its own rules and they overflow
 * any grid they sit in.
 */
export function TimeField({
  value,
  onValueChange,
  step = 15,
  size = "default",
  placeholder = "––:––",
  /** What −/+ start from while empty. */
  fallback,
  clearable = false,
  "aria-label": ariaLabel,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  step?: number;
  size?: "default" | "lg";
  placeholder?: string;
  fallback?: string;
  clearable?: boolean;
  "aria-label": string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const base = value || fallback;
  const large = size === "lg";

  return (
    <div
      className={cn(
        "flex min-w-0 items-stretch overflow-hidden rounded-md border bg-background",
        large ? "h-16" : "h-11",
        className,
      )}
    >
      <button
        type="button"
        aria-label={`${ariaLabel} ${step} minutes earlier`}
        disabled={!base}
        onClick={() => base && onValueChange(stepTime(base, step, -1))}
        className={cn(
          "flex shrink-0 items-center justify-center text-muted-foreground transition-colors active:bg-muted disabled:opacity-40",
          large ? "w-16" : "w-10",
        )}
      >
        <Minus className={large ? "size-5" : "size-4"} />
      </button>
      <label className="relative flex min-w-0 flex-1 items-center justify-center border-x">
        <span
          className={cn(
            "pointer-events-none font-medium tabular-nums",
            large ? "text-3xl tracking-tight" : "text-base",
            !value && "text-muted-foreground",
          )}
        >
          {value || placeholder}
        </span>
        <input
          ref={input}
          type="time"
          value={value}
          aria-label={ariaLabel}
          onChange={(event) => onValueChange(event.target.value)}
          onClick={() => {
            try {
              input.current?.showPicker();
            } catch {
              // Not every engine exposes the picker; a tap still focuses it.
            }
          }}
          className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
        />
      </label>
      {clearable && value ? (
        <button
          type="button"
          aria-label={`Clear ${ariaLabel}`}
          onClick={() => onValueChange("")}
          className={cn(
            "flex shrink-0 items-center justify-center border-r text-muted-foreground transition-colors active:bg-muted",
            large ? "w-12" : "w-9",
          )}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`${ariaLabel} ${step} minutes later`}
        disabled={!base}
        onClick={() => base && onValueChange(stepTime(base, step, 1))}
        className={cn(
          "flex shrink-0 items-center justify-center text-muted-foreground transition-colors active:bg-muted disabled:opacity-40",
          large ? "w-16" : "w-10",
        )}
      >
        <Plus className={large ? "size-5" : "size-4"} />
      </button>
    </div>
  );
}
