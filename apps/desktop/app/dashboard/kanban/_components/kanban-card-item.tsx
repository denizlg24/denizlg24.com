"use client";

import { Badge } from "@repo/ui/badge";
import { cn } from "@repo/ui/utils";
import { differenceInCalendarDays, format, isPast } from "date-fns";
import { Calendar, Link2 } from "lucide-react";
import type { ComponentProps, MouseEvent as ReactMouseEvent } from "react";
import { useRef } from "react";
import type { IKanbanCard, KanbanPriority } from "@/lib/data-types";

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

export const PRIORITY_BADGE: Record<
  KanbanPriority,
  { label: string; variant: BadgeVariant } | null
> = {
  none: null,
  low: { label: "Low", variant: "secondary" },
  medium: { label: "Medium", variant: "info" },
  high: { label: "High", variant: "warning" },
  urgent: { label: "Urgent", variant: "critical" },
};

function formatDueDate(value: Date | string, hasDueTime?: boolean) {
  const date = new Date(value);
  const time = hasDueTime ? ` ${format(date, "HH:mm")}` : "";
  const days = differenceInCalendarDays(date, new Date());
  if (days === 0) return `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days < 7) return `${format(date, "EEE")}${time}`;
  return `${format(date, "d MMM")}${time}`;
}

interface KanbanCardItemProps {
  card: IKanbanCard;
  isDoneColumn: boolean;
  nextCardId: string | null;
  isDraggingCard: boolean;
  isDragged: boolean;
  manualSort: boolean;
  onDragStart: () => void;
  onDragOver: (beforeCardId: string | null) => void;
  onDrop: () => void;
  onClick: () => void;
}

export function KanbanCardItem({
  card,
  isDoneColumn,
  nextCardId,
  isDraggingCard,
  isDragged,
  manualSort,
  onDragStart,
  onDragOver,
  onDrop,
  onClick,
}: KanbanCardItemProps) {
  const isDraggingRef = useRef(false);
  const attachmentCount =
    (card.calendarEventIds?.length ?? 0) +
    (card.noteIds?.length ?? 0) +
    (card.personIds?.length ?? 0) +
    (card.courseIds?.length ?? 0);
  const priority = PRIORITY_BADGE[card.priority];
  const overdue = Boolean(
    card.dueDate && isPast(new Date(card.dueDate)) && !isDoneColumn,
  );

  const handleMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const onMove = (moveEvent: MouseEvent) => {
      if (
        Math.abs(moveEvent.clientX - startX) > 5 ||
        Math.abs(moveEvent.clientY - startY) > 5
      ) {
        isDraggingRef.current = true;
        onDragStart();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const hasFooter = Boolean(card.dueDate || priority || attachmentCount > 0);

  return (
    <button
      type="button"
      onMouseDown={handleMouseDown}
      onMouseMove={(event) => {
        if (!isDraggingCard || !manualSort) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onDragOver(
          event.clientY < rect.top + rect.height / 2 ? card._id : nextCardId,
        );
      }}
      onMouseUp={(event) => {
        if (!isDraggingCard) return;
        event.stopPropagation();
        onDrop();
      }}
      onClick={() => {
        if (isDraggingRef.current) {
          isDraggingRef.current = false;
          return;
        }
        onClick();
      }}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-md border border-border/70 bg-background px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-surface/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        isDragged && "opacity-40",
      )}
    >
      {card.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.labels.slice(0, 4).map((label) => (
            <Badge key={label} variant="secondary">
              {label}
            </Badge>
          ))}
        </div>
      )}
      <p
        className={cn(
          "line-clamp-2 text-sm leading-snug",
          isDoneColumn
            ? "text-muted-foreground line-through"
            : "text-accent-strong",
        )}
      >
        {card.title}
      </p>
      {card.description && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {card.description}
        </p>
      )}
      {hasFooter && (
        <div className="flex items-center gap-2 pt-0.5 text-[11px] text-muted-foreground">
          {card.dueDate && (
            <span
              className={cn(
                "flex min-w-0 items-center gap-1 tabular-nums",
                overdue && "font-medium text-status-critical",
              )}
            >
              <Calendar className="size-3 shrink-0" />
              <span className="truncate">
                {formatDueDate(card.dueDate, card.hasDueTime)}
              </span>
            </span>
          )}
          <span className="flex-1" />
          {attachmentCount > 0 && (
            <span className="flex items-center gap-1 tabular-nums">
              <Link2 className="size-3" />
              {attachmentCount}
            </span>
          )}
          {priority && (
            <Badge variant={priority.variant}>{priority.label}</Badge>
          )}
        </div>
      )}
    </button>
  );
}
