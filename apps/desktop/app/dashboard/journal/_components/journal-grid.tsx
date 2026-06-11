"use client";

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { IJournalLog } from "@/lib/data-types";
import { cn } from "@/lib/utils";

interface JournalGridProps {
  month: Date;
  journals: IJournalLog[];
  loading: boolean;
  onSelectDate: (date: Date) => void;
  onMonthChange: (date: Date) => void;
}

export function JournalGrid({
  month,
  journals,
  loading,
  onSelectDate,
  onMonthChange,
}: JournalGridProps) {
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [month]);

  const journalDates = useMemo(() => {
    const set = new Set<string>();
    for (const j of journals) {
      set.add(format(new Date(j.date), "yyyy-MM-dd"));
    }
    return set;
  }, [journals]);

  const hasContent = (date: Date) => {
    const key = format(date, "yyyy-MM-dd");
    const journal = journals.find(
      (j) => format(new Date(j.date), "yyyy-MM-dd") === key,
    );
    if (!journal) return false;
    return journal.content.trim().length > 0;
  };

  const isCurrentMonth = (date: Date) =>
    date.getMonth() === month.getMonth() &&
    date.getFullYear() === month.getFullYear();

  return (
    <div className="flex flex-col h-full w-full select-none">
      <div className="flex items-center justify-between px-4 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onMonthChange(subMonths(month, 1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <h2 className="text-sm font-calistoga lowercase tracking-tight text-muted-foreground">
          {format(month, "MMMM yyyy")}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onMonthChange(addMonths(month, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-7 grid-rows-[auto_repeat(auto-fill,1fr)] px-4 pb-4">
        {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => (
          <div
            key={i}
            className="flex items-end justify-center pb-2 text-[9px] uppercase tracking-widest text-muted-foreground/40"
          >
            {day}
          </div>
        ))}

        {calendarDays.map((date) => {
          const inMonth = isCurrentMonth(date);
          const today = isToday(date);
          const hasEntry =
            !loading && journalDates.has(format(date, "yyyy-MM-dd"));
          const filled = hasEntry && hasContent(date);

          return (
            <button
              type="button"
              key={date.toISOString()}
              disabled={loading}
              onClick={() => onSelectDate(date)}
              className={cn(
                "group flex items-center justify-center cursor-pointer transition-opacity",
                loading && "cursor-default",
              )}
            >
              <div className="relative flex items-center justify-center">
                <div
                  className={cn(
                    "size-3 rounded-full transition-all duration-200",
                    !inMonth && "bg-border/40",
                    inMonth && !hasEntry && "bg-border",
                    inMonth && hasEntry && !filled && "bg-accent",
                    inMonth && filled && "bg-accent-strong",
                    today &&
                      inMonth &&
                      "ring-2 ring-foreground/30 ring-offset-2 ring-offset-background",
                    inMonth && !loading && "group-hover:scale-[2]",
                  )}
                />
                <span
                  className={cn(
                    "absolute top-full mt-1 text-[9px] tabular-nums transition-opacity duration-150",
                    today
                      ? "opacity-100 text-foreground/60"
                      : "opacity-0 group-hover:opacity-100 text-muted-foreground/50",
                  )}
                >
                  {format(date, "d")}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
