"use client";

import { format } from "date-fns";
import { Calendar, CheckCircle2, FileText } from "lucide-react";
import { useRef } from "react";
import type { IKanbanCard, KanbanPriority } from "@/lib/data-types";

const PRIORITY_CONFIG: Record<
  KanbanPriority,
  { label: string; className: string } | null
> = {
  none: null,
  low: {
    label: "Low",
    className:
      "bg-blue-50 text-blue-600 border border-blue-100 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-900",
  },
  medium: {
    label: "Medium",
    className:
      "bg-amber-50 text-amber-600 border border-amber-100 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-900",
  },
  high: {
    label: "High",
    className:
      "bg-orange-50 text-orange-600 border border-orange-100 dark:bg-orange-950/60 dark:text-orange-400 dark:border-orange-900",
  },
  urgent: {
    label: "Urgent",
    className:
      "bg-red-50 text-red-600 border border-red-100 dark:bg-red-950/60 dark:text-red-400 dark:border-red-900",
  },
};

interface KanbanCardItemProps {
  card: IKanbanCard;
  nextCardId: string | null;
  isDraggingCard: boolean;
  onDragStart: () => void;
  onDragOver: (beforeCardId: string | null) => void;
  onDrop: () => void;
  onClick: () => void;
  onToggleDone: () => void;
}

export function KanbanCardItem({
  card,
  nextCardId,
  isDraggingCard,
  onDragStart,
  onDragOver,
  onDrop,
  onClick,
  onToggleDone,
}: KanbanCardItemProps) {
  const isDraggingRef = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (me: MouseEvent) => {
      if (
        Math.abs(me.clientX - startX) > 5 ||
        Math.abs(me.clientY - startY) > 5
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

  const handleClick = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }
    onClick();
  };

  const NOTE_LINK_RE = /^\[note\]\(([^,]+),(.+)\)$/;
  const noteMatch = NOTE_LINK_RE.exec(card.description ?? "");
  const linkedNoteName = noteMatch ? noteMatch[2] : null;

  const isPastDue = card.dueDate && new Date(card.dueDate) < new Date();
  const priorityConfig = PRIORITY_CONFIG[card.priority];
  const hasFooter = !!card.dueDate || !!priorityConfig;
  const isDone = card.labels.some((label) => label.toLowerCase() === "done");

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={(e) => {
        if (!isDraggingCard) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const isTopHalf = e.clientY < rect.top + rect.height / 2;
        onDragOver(isTopHalf ? card._id : nextCardId);
      }}
      onMouseUp={(e) => {
        if (!isDraggingCard) return;
        e.stopPropagation();
        onDrop();
      }}
      onClick={handleClick}
      className="group bg-card rounded-xl border shadow-sm p-4 cursor-pointer select-none transition-all duration-150 hover:shadow-md active:opacity-60"
    >
      <button
        type="button"
        aria-label={isDone ? "Mark card as not done" : "Mark card as done"}
        title={isDone ? "Mark as not done" : "Mark as done"}
        className={`float-right -mt-1 -mr-1 ml-2 size-7 rounded-full flex items-center justify-center transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          isDone
            ? "text-primary opacity-100"
            : "text-muted-foreground opacity-0"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone();
        }}
      >
        <CheckCircle2 className="size-4" />
      </button>

      {card.labels && card.labels.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-2.5">
          {card.labels.slice(0, 4).map((label) => (
            <span
              key={label}
              className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary leading-none"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      <p className="text-sm font-semibold leading-snug text-foreground line-clamp-2">
        {card.title}
      </p>

      {linkedNoteName ? (
        <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
          <FileText className="size-3 shrink-0" />
          <span className="truncate">{linkedNoteName}</span>
        </div>
      ) : (
        card.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-1.5 leading-relaxed">
            {card.description}
          </p>
        )
      )}

      {hasFooter && (
        <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border/60">
          {card.dueDate ? (
            <div
              className={`flex items-center gap-1.5 text-xs font-medium ${
                isPastDue ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              <Calendar className="size-3 shrink-0" />
              <span>{format(new Date(card.dueDate), "d MMM")}</span>
            </div>
          ) : (
            <span />
          )}

          {priorityConfig && (
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full leading-none ${priorityConfig.className}`}
            >
              {priorityConfig.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
