"use client";

import {
  CATEGORY_ACCENT,
  CATEGORY_LABELS,
  CATEGORY_SPINE,
  TRIAGE_CATEGORIES,
} from "@repo/admin/triage/category-meta";
import { Button } from "@repo/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@repo/ui/select";
import { cn } from "@repo/ui/utils";
import {
  CalendarClock,
  Check,
  CircleCheck,
  ListTodo,
  Loader2,
  PenLine,
  Tag,
} from "lucide-react";
import type { IEmailTriage, TriageCategory } from "@/lib/data-types";

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

function isTriageCategory(value: string): value is TriageCategory {
  return TRIAGE_CATEGORIES.some((category) => category === value);
}

export function TriageRow({
  item,
  selected,
  busy = false,
  onSelect,
  onConfirm,
  onRecategorize,
}: {
  item: IEmailTriage;
  selected: boolean;
  busy?: boolean;
  onSelect: () => void;
  /** Accepts the model's own category and clears the review flag. */
  onConfirm: () => void;
  onRecategorize: (category: TriageCategory) => void;
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
    // A div, not a button: the row hosts its own controls, and a select inside
    // a button is invalid markup that Radix cannot escape. Opening the row is
    // an overlay button underneath the content instead.
    <div
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group relative flex w-full items-center gap-3 py-2.5 pl-3 pr-1 text-left transition-colors",
        "hover:bg-accent/40 focus-within:bg-accent/40",
        selected && "bg-accent/60",
        busy && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={busy}
        aria-label={`Open ${item.email?.subject ?? "email"}`}
        className="absolute inset-0 z-0 focus-visible:outline-none"
      />

      <span
        aria-hidden
        className={cn(
          "absolute inset-y-1.5 left-0 w-0.5 rounded-full",
          CATEGORY_SPINE[item.category],
        )}
      />

      <div className="pointer-events-none relative z-10 min-w-0 flex-1">
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

      <div className="pointer-events-none relative z-10 flex shrink-0 items-center gap-3">
        {/*
         * Reclassifying and confirming are the whole job of the review queue,
         * so they happen here rather than behind an open. Always visible on a
         * row that needs review; on every other row they stay out of the way
         * until the pointer or keyboard reaches it.
         */}
        <div
          className={cn(
            "pointer-events-auto flex items-center gap-1",
            !item.reviewRequired &&
              "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          <Select
            value={item.category}
            disabled={busy}
            onValueChange={(value) => {
              if (isTriageCategory(value) && value !== item.category) {
                onRecategorize(value);
              }
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label="Change category"
              className="h-7 w-auto gap-1 border-none px-1.5 shadow-none [&>svg:last-child]:hidden"
            >
              <Tag className="size-3.5 text-muted-foreground" />
            </SelectTrigger>
            <SelectContent align="end">
              {TRIAGE_CATEGORIES.map((category) => (
                <SelectItem key={category} value={category} className="text-xs">
                  {CATEGORY_LABELS[category]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {item.reviewRequired && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={busy}
              aria-label={`Confirm ${CATEGORY_LABELS[item.category]}`}
              onClick={onConfirm}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
            </Button>
          )}
        </div>

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
    </div>
  );
}
