"use client";

import {
  CATEGORY_ACCENT,
  CATEGORY_LABELS,
  CATEGORY_SPINE,
} from "@repo/admin/triage/category-meta";
import { cn } from "@repo/ui/utils";
import { CalendarClock, CircleCheck, ListTodo, PenLine } from "lucide-react";
import type { IEmailTriage } from "@/lib/data-types";

function relativeTime(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Confidence as a shape first, a number second — a screenful of rows shows where
 * the model hedged without reading a single percentage.
 */
function ConfidenceMeter({
  value,
  belowThreshold,
}: {
  value: number;
  belowThreshold: boolean;
}) {
  const percent = Math.round(value * 100);

  return (
    <div className="flex items-center gap-1.5" title={`${percent}% confidence`}>
      <span className="relative block h-[3px] w-10 overflow-hidden rounded-full bg-border">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            belowThreshold ? "bg-status-warning" : "bg-foreground/45",
          )}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </span>
      <span
        className={cn(
          "w-7 text-right text-[11px] tabular-nums",
          belowThreshold ? "text-status-warning" : "text-muted-foreground",
        )}
      >
        {percent}
      </span>
    </div>
  );
}

export function TriageRow({
  item,
  selected,
  onSelect,
}: {
  item: IEmailTriage;
  selected: boolean;
  onSelect: () => void;
}) {
  const sender =
    item.email?.from.map((entry) => entry.name ?? entry.address).join(", ") ??
    "";
  const tasks = item.suggestedTasks.length;
  const events = item.suggestedEvents.length;
  const accepted =
    item.suggestedTasks.filter((task) => task.status === "accepted").length +
    item.suggestedEvents.filter((event) => event.status === "accepted").length;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group relative flex w-full items-center gap-3 py-2.5 pl-3 pr-1 text-left transition-colors",
        "hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none",
        selected && "bg-accent/60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-1.5 left-0 w-0.5 rounded-full",
          CATEGORY_SPINE[item.category],
        )}
      />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-snug">
            {item.email?.subject ?? "(no subject)"}
          </span>
          {item.reviewRequired && (
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-status-warning">
              Review
            </span>
          )}
        </div>

        <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "shrink-0 font-medium uppercase tracking-[0.12em] text-[10px]",
              CATEGORY_ACCENT[item.category],
            )}
          >
            {CATEGORY_LABELS[item.category]}
          </span>
          {item.llmCategory && (
            <span
              className="shrink-0"
              title={`Reclassified from ${CATEGORY_LABELS[item.llmCategory]}`}
            >
              <PenLine className="size-3 text-muted-foreground/70" />
            </span>
          )}
          <span className="shrink-0 text-muted-foreground/40">·</span>
          <span className="min-w-0 flex-1 truncate">{sender}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {(tasks > 0 || events > 0) && (
          <span className="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
            {tasks > 0 && (
              <span
                className="flex items-center gap-1"
                title={`${tasks} tasks`}
              >
                <ListTodo className="size-3" />
                {tasks}
              </span>
            )}
            {events > 0 && (
              <span
                className="flex items-center gap-1"
                title={`${events} events`}
              >
                <CalendarClock className="size-3" />
                {events}
              </span>
            )}
            {accepted > 0 && (
              <CircleCheck
                className="size-3 text-status-good"
                aria-label={`${accepted} accepted`}
              />
            )}
          </span>
        )}

        <ConfidenceMeter
          value={item.confidence}
          belowThreshold={item.reviewRequired}
        />

        <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
          {relativeTime(item.triagedAt)}
        </span>
      </div>
    </button>
  );
}
