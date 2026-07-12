"use client";

import { differenceInCalendarDays, format, isPast } from "date-fns";
import { Calendar, Link2 } from "lucide-react";
import { useRef } from "react";
import type { IKanbanCard, KanbanPriority } from "@/lib/data-types";

const PRIORITY_CONFIG: Record<
  KanbanPriority,
  { label: string; className: string } | null
> = {
  none: null,
  low: {
    label: "Low",
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  medium: {
    label: "Medium",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  high: {
    label: "High",
    className: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  urgent: { label: "Urgent", className: "bg-destructive/10 text-destructive" },
};

function formatDueDate(value: Date | string, hasDueTime?: boolean) {
  const date = new Date(value);
  const time = hasDueTime ? ` · ${format(date, "HH:mm")}` : "";
  const days = differenceInCalendarDays(date, new Date());
  if (days === 0) return `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  if (days < 0) return `${Math.abs(days)}d overdue${time}`;
  return `In ${days} days${time}`;
}

interface KanbanCardItemProps {
  card: IKanbanCard;
  columnColor?: string;
  isDoneColumn: boolean;
  nextCardId: string | null;
  isDraggingCard: boolean;
  manualSort: boolean;
  onDragStart: () => void;
  onDragOver: (beforeCardId: string | null) => void;
  onDrop: () => void;
  onClick: () => void;
}

export function KanbanCardItem({
  card,
  columnColor,
  isDoneColumn,
  nextCardId,
  isDraggingCard,
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
  const priority = PRIORITY_CONFIG[card.priority];
  const overdue = Boolean(
    card.dueDate && isPast(new Date(card.dueDate)) && !isDoneColumn,
  );

  const handleMouseDown = (event: React.MouseEvent) => {
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

  return (
    <button
      type="button"
      onMouseDown={handleMouseDown}
      onMouseEnter={(event) => {
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
      className="group relative w-full rounded-lg border border-border/70 bg-card px-3 py-3 text-left shadow-xs transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-70"
    >
      {card.labels.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {card.labels.slice(0, 4).map((label) => (
            <span
              key={label}
              className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary"
            >
              {label}
            </span>
          ))}
        </div>
      )}
      <p
        className={`line-clamp-2 text-sm font-medium leading-snug ${isDoneColumn ? "text-muted-foreground line-through" : "text-foreground"}`}
      >
        {card.title}
      </p>
      {card.description && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {card.description}
        </p>
      )}
      {(card.dueDate || priority || attachmentCount > 0) && (
        <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-2 text-[11px]">
          {card.dueDate && (
            <span
              className={`flex min-w-0 items-center gap-1 ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}
            >
              <Calendar className="size-3 shrink-0" />
              <span className="truncate">
                {formatDueDate(card.dueDate, card.hasDueTime)}
              </span>
            </span>
          )}
          <span className="flex-1" />
          {attachmentCount > 0 && (
            <span
              className="flex items-center gap-1 text-muted-foreground"
              title={`${attachmentCount} attachments`}
            >
              <Link2 className="size-3" /> {attachmentCount}
            </span>
          )}
          {priority && (
            <span
              className={`rounded-full px-1.5 py-0.5 font-medium ${priority.className}`}
            >
              {priority.label}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
