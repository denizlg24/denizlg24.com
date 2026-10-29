import {
  TRIAGE_ATTENTION_ORDER,
  TRIAGE_CATEGORY_LABELS,
  type TriageCategory,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { cn } from "@repo/ui/utils";
import type { ComponentProps } from "react";

export const TRIAGE_CATEGORIES = TRIAGE_ATTENTION_ORDER;
export const CATEGORY_LABELS = TRIAGE_CATEGORY_LABELS;

/**
 * Per-category accent, ordered loosely by how much attention the category wants.
 * Used as a text colour on labels and as a spine on list rows so a screenful of
 * triage reads as a shape before it reads as words.
 */
export const CATEGORY_ACCENT: Record<TriageCategory, string> = {
  "action-needed": "text-status-critical",
  scheduled: "text-status-warning",
  purchases: "text-chart-6",
  fyi: "text-chart-4",
  newsletter: "text-chart-3",
  promo: "text-muted-foreground",
  spam: "text-muted-foreground/60",
};

export const CATEGORY_SPINE: Record<TriageCategory, string> = {
  "action-needed": "bg-status-critical",
  scheduled: "bg-status-warning",
  purchases: "bg-chart-6",
  fyi: "bg-chart-4",
  newsletter: "bg-chart-3",
  promo: "bg-border",
  spam: "bg-border",
};

const CATEGORY_VARIANT: Record<
  TriageCategory,
  ComponentProps<typeof Badge>["variant"]
> = {
  "action-needed": "critical",
  scheduled: "warning",
  purchases: "info",
  fyi: "secondary",
  newsletter: "outline",
  promo: "outline",
  spam: "outline",
};

export function CategoryBadge({
  category,
  className,
}: {
  category: TriageCategory;
  className?: string;
}) {
  return (
    <Badge variant={CATEGORY_VARIANT[category]} className={className}>
      {CATEGORY_LABELS[category]}
    </Badge>
  );
}

/** Compact, badge-free category label for dense rows. */
export function CategoryLabel({
  category,
  className,
}: {
  category: TriageCategory;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-[10px] font-medium uppercase tracking-[0.12em]",
        CATEGORY_ACCENT[category],
        className,
      )}
    >
      {CATEGORY_LABELS[category]}
    </span>
  );
}
