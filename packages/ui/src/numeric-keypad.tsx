"use client";

import { Delete } from "lucide-react";

import { Button } from "./button";
import { cn } from "./utils";

type NumericKeypadProps = {
  value: string;
  onValueChange: (value: string) => void;
  onDone?: () => void;
  decimalSeparator?: "." | ",";
  className?: string;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function NumericKeypad({
  value,
  onValueChange,
  onDone,
  decimalSeparator = ".",
  className,
}: NumericKeypadProps) {
  const append = (key: string) => {
    const normalizedKey = key === "," ? "." : key;
    if (normalizedKey === "." && value.includes(".")) return;
    onValueChange(`${value}${normalizedKey}`);
  };

  return (
    <div
      role="group"
      className={cn("grid grid-cols-3 gap-2 p-3", className)}
      aria-label="Numeric keypad"
    >
      {KEYS.map((key) => (
        <Button
          key={key}
          type="button"
          variant="secondary"
          className="h-12 text-lg"
          onClick={() => append(key)}
        >
          {key}
        </Button>
      ))}
      <Button
        type="button"
        variant="secondary"
        className="h-12 text-lg"
        onClick={() => append(decimalSeparator)}
      >
        {decimalSeparator}
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="h-12 text-lg"
        onClick={() => append("0")}
      >
        0
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="h-12"
        aria-label="Delete last digit"
        onClick={() => onValueChange(value.slice(0, -1))}
      >
        <Delete />
      </Button>
      {onDone ? (
        <Button type="button" className="col-span-3 h-12" onClick={onDone}>
          Done
        </Button>
      ) : null}
    </div>
  );
}
