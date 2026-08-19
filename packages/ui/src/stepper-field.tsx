"use client";

import { Minus, Plus } from "lucide-react";

import { Button } from "./button";
import { NumericField } from "./numeric-field";
import { cn } from "./utils";

type StepperFieldProps = {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  presets?: number[];
  className?: string;
  label?: string;
};

export function StepperField({
  value,
  onValueChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  presets = [0.5, 1, 1.5, 2],
  className,
  label = "Quantity",
}: StepperFieldProps) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label={`Decrease ${label.toLowerCase()}`}
          onClick={() => onValueChange(clamp(value - step))}
        >
          <Minus />
        </Button>
        <NumericField
          aria-label={label}
          className="h-10 text-center"
          value={String(value)}
          onValueChange={(_, numeric) => {
            if (numeric !== null) onValueChange(clamp(numeric));
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label={`Increase ${label.toLowerCase()}`}
          onClick={() => onValueChange(clamp(value + step))}
        >
          <Plus />
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {presets.map((preset) => (
          <Button
            key={preset}
            type="button"
            variant={value === preset ? "secondary" : "ghost"}
            className="min-h-11"
            onClick={() => onValueChange(clamp(preset))}
          >
            {preset}
          </Button>
        ))}
      </div>
    </div>
  );
}
