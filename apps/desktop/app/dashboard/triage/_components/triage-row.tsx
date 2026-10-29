"use client";

import {
  CATEGORY_LABELS,
  CATEGORY_SPINE,
  TRIAGE_CATEGORIES,
} from "@repo/admin/triage/category-meta";
import { Button } from "@repo/ui/button";
import { ListRow } from "@repo/ui/list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@repo/ui/select";
import { Spinner } from "@repo/ui/spinner";
import { cn } from "@repo/ui/utils";
import { CalendarClock, Check, ListTodo, PencilLine, Tag } from "lucide-react";
import type { IEmailTriage, TriageCategory } from "@/lib/data-types";

export function relativeTime(iso: string): string {
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

export function isTriageCategory(value: string): value is TriageCategory {
  return TRIAGE_CATEGORIES.some((category) => category === value);
}

export function triageSender(item: Pick<IEmailTriage, "email">): string {
  const from = item.email?.from ?? [];
  return (
    from.map((entry) => entry.name || entry.address).join(", ") || "Unknown"
  );
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
  const tasks = item.suggestedTasks.length;
  const events = item.suggestedEvents.length;
  const changes = item.suggestedActions.length;
  const open = [
    ...item.suggestedTasks,
    ...item.suggestedEvents,
    ...item.suggestedActions,
  ].filter((entry) => entry.status === "pending").length;
  const confidence = Math.round(item.confidence * 100);

  return (
    <ListRow
      selected={selected}
      onClick={busy ? undefined : onSelect}
      className={cn("group/triage", busy && "opacity-50")}
      leading={
        <span
          role="img"
          aria-label={CATEGORY_LABELS[item.category]}
          title={CATEGORY_LABELS[item.category]}
          className={cn(
            "h-4 w-0.5 rounded-full",
            CATEGORY_SPINE[item.category],
          )}
        />
      }
      title={triageSender(item)}
      description={item.email?.subject || "(No subject)"}
      meta={
        <>
          {tasks + events + changes > 0 ? (
            <span
              className={cn(
                "flex items-center gap-1",
                open === 0 && "text-muted-foreground/60",
              )}
              title={`${open} open of ${tasks + events + changes}`}
            >
              {tasks > 0 ? <ListTodo className="size-3" /> : null}
              {events > 0 ? <CalendarClock className="size-3" /> : null}
              {changes > 0 ? <PencilLine className="size-3" /> : null}
              {tasks + events + changes}
            </span>
          ) : null}
          {item.reviewRequired ? (
            <span className="text-status-warning">{confidence}%</span>
          ) : null}
          <span className="w-8 text-right">{relativeTime(item.triagedAt)}</span>
        </>
      }
      trailing={
        // Reclassifying and confirming are the review queue's whole job, so
        // they stay on the row; elsewhere they appear on hover or focus.
        // Stops propagation so a pick in the portalled menu does not also
        // open the row.
        <span
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          className={cn(
            "flex items-center",
            !item.reviewRequired &&
              "opacity-0 transition-opacity group-hover/triage:opacity-100 group-focus-within/triage:opacity-100",
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
              className="h-7 w-auto gap-1 border-none bg-transparent px-1.5 shadow-none [&>svg:last-child]:hidden"
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
          {item.reviewRequired ? (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={`Confirm ${CATEGORY_LABELS[item.category]}`}
              onClick={onConfirm}
            >
              {busy ? <Spinner className="size-3.5" /> : <Check />}
            </Button>
          ) : null}
        </span>
      }
    />
  );
}
