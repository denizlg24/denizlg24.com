import { cn } from "@repo/ui/utils";

import { formatDay, plural } from "@/lib/format";

export function ReportsChart({
  days,
}: {
  days: readonly { day: string; count: number }[];
}) {
  if (days.length === 0) return null;
  const max = Math.max(1, ...days.map((entry) => entry.count));
  const total = days.reduce((sum, entry) => sum + entry.count, 0);
  const peak = days.reduce((best, entry) =>
    entry.count > best.count ? entry : best,
  );
  const summary =
    total === 0
      ? "No reports in the last 30 days"
      : `${plural(total, "report")} in the last 30 days, peak ${peak.count} on ${formatDay(peak.day)}`;
  const first = days[0];

  return (
    <figure className="flex flex-col gap-2 pt-4">
      <div className="relative h-28 border-b">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 border-t border-dashed border-border"
        />
        <span
          aria-hidden
          className="absolute top-0 right-0 -translate-y-full pb-1 text-[11px] leading-none tabular-nums text-muted-foreground"
        >
          {max}
        </span>
        <div
          role="img"
          aria-label={summary}
          className="absolute inset-0 flex items-end gap-[2px] sm:gap-[3px]"
        >
          {days.map((entry, index) => {
            const today = index === days.length - 1;
            return (
              <div
                key={entry.day}
                title={`${formatDay(entry.day)} · ${plural(entry.count, "report")}`}
                className="group flex h-full min-w-0 flex-1 items-end"
              >
                {entry.count > 0 ? (
                  <div
                    className={cn(
                      "w-full rounded-t-[2px] transition-colors",
                      today
                        ? "bg-accent-strong"
                        : "bg-foreground/70 group-hover:bg-accent-strong",
                    )}
                    style={{
                      height: `${Math.max(6, (entry.count / max) * 100)}%`,
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <figcaption className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{first ? formatDay(first.day) : null}</span>
        <span>Today</span>
      </figcaption>
    </figure>
  );
}
