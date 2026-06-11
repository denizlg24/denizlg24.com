import { Badge } from "@/components/ui/badge";
import type { TriageCategory } from "@/lib/data-types";

const CATEGORY_LABELS: Record<TriageCategory, string> = {
  spam: "Spam",
  newsletter: "Newsletter",
  promo: "Promo",
  purchases: "Purchases",
  fyi: "FYI",
  "action-needed": "Action Needed",
  scheduled: "Scheduled",
};

const CATEGORY_VARIANT: Record<
  TriageCategory,
  "default" | "secondary" | "outline" | "destructive"
> = {
  spam: "destructive",
  newsletter: "outline",
  promo: "outline",
  purchases: "outline",
  fyi: "secondary",
  "action-needed": "default",
  scheduled: "default",
};

export function CategoryBadge({ category }: { category: TriageCategory }) {
  return (
    <Badge variant={CATEGORY_VARIANT[category]} className="text-xs">
      {CATEGORY_LABELS[category]}
    </Badge>
  );
}
