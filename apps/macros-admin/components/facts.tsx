import { cn } from "@repo/ui/utils";
import type { ReactNode } from "react";

/** Label/value pairs on hairlines, for a narrow column. */
export function Facts({
  items,
  className,
}: {
  items: { label: string; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("flex flex-col text-sm", className)}>
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0"
        >
          <dt className="shrink-0 text-xs text-muted-foreground">
            {item.label}
          </dt>
          <dd className="min-w-0 text-right break-words tabular-nums">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
