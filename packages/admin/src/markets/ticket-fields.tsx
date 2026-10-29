"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { cn } from "@repo/ui/utils";
import type { ReactNode } from "react";
import { toneClass } from "./format";

const FRACTIONS = [0.25, 0.5, 0.75, 1];

/**
 * A size input whose unit flips between shares and money. Built by hand rather
 * than with FormField: a unit button inside a `<label>` is its first labelable
 * descendant, so clicking the label text would flip the unit.
 */
export function SizeField({
  id,
  shares,
  baseCurrency,
  value,
  onValueChange,
  onToggleUnit,
}: {
  id: string;
  shares: boolean;
  baseCurrency: string;
  value: string;
  onValueChange: (value: string) => void;
  onToggleUnit: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="font-medium text-muted-foreground text-xs"
        >
          {shares ? "Quantity" : `Value (${baseCurrency})`}
        </label>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="-my-1 h-5 px-1.5 text-muted-foreground"
          onClick={onToggleUnit}
        >
          {shares ? baseCurrency : "shares"}
        </Button>
      </div>
      <Input
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        inputMode="decimal"
        className="tabular-nums"
      />
    </div>
  );
}

export function FractionBar({
  onPick,
}: {
  onPick: (fraction: number) => void;
}) {
  return (
    <div className="flex gap-1">
      {FRACTIONS.map((fraction) => (
        <Button
          key={fraction}
          type="button"
          variant="outline"
          size="xs"
          className="flex-1 text-muted-foreground"
          onClick={() => onPick(fraction)}
        >
          {fraction === 1 ? "Max" : `${fraction * 100}%`}
        </Button>
      ))}
    </div>
  );
}

/** What the ticket will do, as hairline-separated label/value rows. */
export function Preview({ children }: { children: ReactNode }) {
  return (
    <dl className="flex flex-col gap-1 border-t pt-3 text-xs">{children}</dl>
  );
}

export function PreviewRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-accent-strong tabular-nums", toneClass(tone))}>
        {value}
      </dd>
    </div>
  );
}

/** A rejection first; otherwise the warnings that do not block submitting. */
export function TicketNotices({
  problem,
  warnings,
}: {
  problem: string | null;
  warnings: (string | false | null)[];
}) {
  if (problem) return <p className="text-destructive text-xs">{problem}</p>;
  const shown = warnings.filter((item): item is string => Boolean(item));
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((warning) => (
        <Badge key={warning} variant="warning">
          {warning}
        </Badge>
      ))}
    </div>
  );
}

/** The symbol a ticket is locked to, or has picked, with what is held of it. */
export function TickerLine({
  ticker,
  holding,
}: {
  ticker: string;
  holding: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-medium text-accent-strong text-sm tabular-nums">
        {ticker}
      </span>
      {holding ? (
        <span className="text-muted-foreground text-xs tabular-nums">
          {holding}
        </span>
      ) : null}
    </div>
  );
}
