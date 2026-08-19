"use client";

import * as React from "react";

import { Input } from "./input";

export function normalizeDecimalInput(value: string): string {
  const normalized = value.replace(/,/g, ".").replace(/[^0-9.-]/g, "");
  const [integer = "", ...fractionParts] = normalized.split(".");
  const sign = integer.startsWith("-") ? "-" : "";
  const digits = integer.replace(/-/g, "");
  return fractionParts.length > 0
    ? `${sign}${digits}.${fractionParts.join("")}`
    : `${sign}${digits}`;
}

type NumericFieldProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "inputMode" | "value" | "defaultValue" | "onChange"
> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string, numericValue: number | null) => void;
  allowNegative?: boolean;
  selectOnFocus?: boolean;
};

export function NumericField({
  value,
  defaultValue,
  onValueChange,
  allowNegative = false,
  selectOnFocus = true,
  enterKeyHint = "done",
  onFocus,
  ...props
}: NumericFieldProps) {
  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      let next = normalizeDecimalInput(event.target.value);
      if (!allowNegative) next = next.replace(/-/g, "");
      const parsed = Number(next);
      onValueChange?.(
        next,
        next === "" || !Number.isFinite(parsed) ? null : parsed,
      );
    },
    [allowNegative, onValueChange],
  );

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      enterKeyHint={enterKeyHint}
      value={value}
      defaultValue={defaultValue}
      onChange={handleChange}
      onFocus={(event) => {
        if (selectOnFocus) event.currentTarget.select();
        onFocus?.(event);
      }}
    />
  );
}
