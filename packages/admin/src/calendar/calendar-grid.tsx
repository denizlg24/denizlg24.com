"use client";

import type { ICalendarEvent } from "@repo/schemas";
import { cn } from "@repo/ui/utils";
import { useMemo } from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 5;

function getMonthData(year: number, month: number) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = (new Date(year, month, 1).getDay() + 6) % 7;
  return { daysInMonth, startDow };
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatEventTime(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function toCalendarDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The day an event belongs to: its stored calendar date, else its local start day. */
export function eventDateKey(event: ICalendarEvent) {
  return event.calendarDate ?? toCalendarDateKey(new Date(event.date));
}

export function compareEvents(left: ICalendarEvent, right: ICalendarEvent) {
  if (left.isAllDay !== right.isAllDay) return left.isAllDay ? -1 : 1;
  return new Date(left.date).getTime() - new Date(right.date).getTime();
}

/** Left-edge accent per kind, from the status palette; plain events carry none. */
export const EVENT_KIND_ACCENT: Record<ICalendarEvent["kind"], string> = {
  manual: "border-l-transparent",
  meeting: "border-l-status-good",
  flight: "border-l-status-info",
  holiday: "border-l-status-warning",
  birthday: "border-l-status-serious",
};

/** The same palette as a fill, for a dot or bar beside a row. */
export const EVENT_KIND_DOT: Record<ICalendarEvent["kind"], string> = {
  manual: "bg-border",
  meeting: "bg-status-good",
  flight: "bg-status-info",
  holiday: "bg-status-warning",
  birthday: "bg-status-serious",
};

export function eventChipClass(event: ICalendarEvent) {
  return cn(
    "border-l-2 bg-surface text-accent-strong dark:bg-muted",
    EVENT_KIND_ACCENT[event.kind] ?? EVENT_KIND_ACCENT.manual,
    event.status === "completed" && "text-muted-foreground line-through",
    event.status === "canceled" &&
      "text-muted-foreground line-through opacity-50",
  );
}

interface CalendarGridProps {
  year: number;
  /** 0-based. */
  month: number;
  events?: ICalendarEvent[];
  onEventClick?: (event: ICalendarEvent) => void;
  onDayClick?: (date: Date) => void;
}

export function CalendarGrid({
  year,
  month,
  events = [],
  onEventClick,
  onDayClick,
}: CalendarGridProps) {
  const today = new Date();
  const { daysInMonth, startDow } = getMonthData(year, month);
  const rows = Math.ceil((startDow + daysInMonth) / 7);

  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, ICalendarEvent[]>();
    for (const event of events) {
      const key = eventDateKey(event);
      const list = grouped.get(key) ?? [];
      list.push(event);
      grouped.set(key, list);
    }
    for (const list of grouped.values()) list.sort(compareEvents);
    return grouped;
  }, [events]);

  const cells = Array.from({ length: rows * 7 }, (_, i) => {
    const dayNum = i - startDow + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      return { day: null, date: null, key: `blank-${year}-${month}-${i}` };
    }
    return {
      day: dayNum,
      date: new Date(year, month, dayNum),
      key: `${year}-${month}-${dayNum}`,
    };
  });

  return (
    <div className="overflow-x-auto rounded-md border">
      <div className="grid min-w-0 grid-cols-7 md:min-w-140">
        {DAYS.map((day) => (
          <div
            key={day}
            className="border-r border-b px-1 py-1.5 text-center text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground last:border-r-0 sm:px-2"
          >
            {day}
          </div>
        ))}

        {cells.map((cell, index) => {
          const isToday = cell.date !== null && isSameDay(cell.date, today);
          const dateKey = cell.date ? toCalendarDateKey(cell.date) : null;
          const dayEvents = dateKey ? (eventsByDate.get(dateKey) ?? []) : [];
          const lastRow = index >= (rows - 1) * 7;

          return (
            <div
              key={cell.key}
              className={cn(
                "relative flex aspect-square flex-col gap-1 overflow-hidden border-r border-b p-1 pt-6 text-left transition-colors sm:p-1.5 sm:pt-7",
                "nth-[7n]:border-r-0",
                lastRow && "border-b-0",
                cell.day === null
                  ? "bg-surface/30"
                  : "cursor-pointer hover:bg-surface/50",
              )}
            >
              {cell.date !== null && (
                <>
                  <button
                    type="button"
                    className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
                    onClick={() => cell.date && onDayClick?.(cell.date)}
                    aria-label={`Open ${dateKey}`}
                  />
                  <span
                    className={cn(
                      "pointer-events-none absolute top-1 right-1 z-10 inline-flex size-5 items-center justify-center text-xs tabular-nums leading-none text-muted-foreground",
                      isToday &&
                        "rounded-full bg-accent-strong font-semibold text-background",
                    )}
                  >
                    {cell.day}
                  </span>

                  {dayEvents.length > 0 && (
                    <div className="flex w-full min-w-0 flex-col gap-0.5 overflow-hidden">
                      <span className="mx-auto size-1.5 rounded-full bg-accent-strong md:hidden" />
                      {dayEvents.slice(0, MAX_CHIPS).map((event) => (
                        <button
                          type="button"
                          key={event._id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEventClick?.(event);
                          }}
                          className={cn(
                            "relative z-10 hidden min-w-0 overflow-hidden rounded-sm px-1 py-0.5 text-left text-[10px] leading-tight text-ellipsis whitespace-nowrap transition-colors hover:bg-muted md:block",
                            eventChipClass(event),
                          )}
                        >
                          <span className="tabular-nums text-muted-foreground">
                            {event.isAllDay
                              ? "All day"
                              : formatEventTime(event.date)}
                          </span>{" "}
                          {event.title}
                        </button>
                      ))}
                      {dayEvents.length > MAX_CHIPS && (
                        <span className="hidden px-1 text-[10px] tabular-nums text-muted-foreground md:inline">
                          +{dayEvents.length - MAX_CHIPS}
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
