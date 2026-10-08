import type {
  MacrosContributorRef,
  MacrosFoodReportReason,
  MacrosModerationFood,
} from "@repo/schemas/macros";
import { Badge } from "@repo/ui/badge";
import { StatusDot } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import Link from "next/link";

import {
  formatAbsolute,
  formatCount,
  formatGrams,
  formatRelative,
} from "@/lib/format";
import {
  type ModerationState,
  REASON_SHORT_LABELS,
  STATE_META,
} from "@/lib/moderation";

export function Time({
  iso,
  now,
  className,
}: {
  iso: string;
  now: number;
  className?: string;
}) {
  return (
    <time
      dateTime={iso}
      title={formatAbsolute(iso)}
      className={cn("whitespace-nowrap tabular-nums", className)}
    >
      {formatRelative(iso, now)}
    </time>
  );
}

export function StateBadge({
  state,
  className,
}: {
  state: ModerationState;
  className?: string;
}) {
  const meta = STATE_META[state];
  if (state === "visible") {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        {meta.label}
      </span>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-normal text-foreground", className)}
    >
      <StatusDot tone={meta.tone} />
      {meta.label}
    </Badge>
  );
}

export function ReasonChips({
  entries,
  className,
}: {
  entries: [MacrosFoodReportReason, number][];
  className?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1", className)}>
      {entries.map(([reason, count]) => (
        <li key={reason}>
          <Badge
            variant="outline"
            className="gap-1 font-normal text-foreground"
          >
            {REASON_SHORT_LABELS[reason]}
            <span className="tabular-nums text-muted-foreground">{count}</span>
          </Badge>
        </li>
      ))}
    </ul>
  );
}

type Serving = Pick<
  MacrosModerationFood,
  | "servingLabel"
  | "caloriesPerServing"
  | "proteinPerServing"
  | "carbsPerServing"
  | "fatPerServing"
>;

export function ServingLine({
  food,
  className,
}: {
  food: Serving;
  className?: string;
}) {
  const macros: [string, number | null][] = [
    ["P", food.proteinPerServing],
    ["C", food.carbsPerServing],
    ["F", food.fatPerServing],
  ];
  const known = macros.filter(
    (entry): entry is [string, number] => entry[1] !== null,
  );
  if (food.caloriesPerServing === null && known.length === 0) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-baseline gap-x-2 tabular-nums",
        className,
      )}
    >
      {food.caloriesPerServing !== null ? (
        <span>
          <span className="text-foreground">
            {formatCount(food.caloriesPerServing)}
          </span>{" "}
          kcal
        </span>
      ) : null}
      {known.map(([letter, grams]) => (
        <span key={letter}>
          {letter} <span className="text-foreground">{formatGrams(grams)}</span>
          g
        </span>
      ))}
      {food.servingLabel ? (
        <span className="text-muted-foreground">/ {food.servingLabel}</span>
      ) : null}
    </span>
  );
}

export function ContributorLink({
  contributor,
  className,
}: {
  contributor: MacrosContributorRef;
  className?: string;
}) {
  return (
    <Link
      href={`/contributors/${contributor.id}`}
      className={cn(
        "rounded-sm font-mono text-xs text-accent-strong underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-accent-strong focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      {contributor.alias}
    </Link>
  );
}

export function Barcode({ value }: { value: string }) {
  return <span className="font-mono text-xs tracking-tight">{value}</span>;
}
