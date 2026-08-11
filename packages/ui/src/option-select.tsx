"use client";

import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { cn } from "./utils";

export interface SelectOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/**
 * Radix refuses an item whose value is the empty string — it reserves it for
 * "nothing selected", so an `<SelectItem value="">all</SelectItem>` throws. Every
 * filter in this repo needs exactly that row, so the sentinel lives here once
 * rather than in each caller.
 *
 * Real values are prefixed on the way in and stripped on the way out, so an
 * option that happens to be named `__none__` — a branch, a container, anything
 * out of a database — selects itself rather than clearing the filter.
 */
const NONE = "__none__";
const VALUE_PREFIX = "v:";

function encode(value: string): string {
  return `${VALUE_PREFIX}${value}`;
}

function decode(value: string): string | null {
  return value === NONE ? null : value.slice(VALUE_PREFIX.length);
}

/**
 * A `Select` over a list, with `null` as a first-class value.
 *
 * Written as a wrapper rather than left to each call site because the native
 * `<select>` it replaces had three behaviours the primitive does not: an option
 * list from an array, an empty option meaning "no filter", and a value that
 * round-trips through the empty string. Reproducing those inline turned every
 * one-line filter into fifteen.
 */
export function OptionSelect<T extends string>({
  value,
  onValueChange,
  options,
  emptyLabel,
  placeholder,
  size = "sm",
  className,
  contentClassName,
  id,
  disabled,
  "aria-label": ariaLabel,
  children,
}: {
  value: T | null;
  onValueChange: (value: T | null) => void;
  options: readonly SelectOption<T>[];
  /**
   * The "no filter" row. Omitted, the control offers no way back to `null` —
   * which is correct for a required field and wrong for a filter.
   */
  emptyLabel?: ReactNode;
  placeholder?: string;
  size?: "sm" | "default";
  className?: string;
  contentClassName?: string;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
  /** Rendered inside the trigger, before the value. An icon, in practice. */
  children?: ReactNode;
}) {
  return (
    <Select
      value={value === null ? NONE : encode(value)}
      disabled={disabled}
      onValueChange={(next) => onValueChange(decode(next) as T | null)}
    >
      <SelectTrigger
        id={id}
        size={size}
        aria-label={ariaLabel}
        className={cn("text-xs", className)}
      >
        {children}
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent align="start" className={contentClassName}>
        {emptyLabel === undefined ? null : (
          <SelectItem value={NONE} className="text-xs">
            {emptyLabel}
          </SelectItem>
        )}
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={encode(option.value)}
            disabled={option.disabled}
            className="text-xs"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
