"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ICalendarEvent } from "@/lib/data-types";
import { cn } from "@/lib/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function getMonthData(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();

  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

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

function eventKindClass(event: ICalendarEvent) {
  if (event.kind === "holiday") return "border-l-2 border-l-amber-400";
  if (event.kind === "birthday") return "border-l-2 border-l-sky-400";
  return "";
}

interface CalendarGridProps {
  events?: ICalendarEvent[];
  onEventClick?: (event: ICalendarEvent) => void;
  onDayClick?: (date: Date) => void;
  onMonthChange?: (start: Date, end: Date) => void;
}

export function CalendarGrid({
  events = [],
  onEventClick,
  onDayClick,
  onMonthChange,
}: CalendarGridProps) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const { daysInMonth, startDow } = getMonthData(year, month);

  const totalCells = startDow + daysInMonth;
  const rows = Math.ceil(totalCells / 7);

  function notifyMonth(y: number, m: number) {
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0, 23, 59, 59);
    onMonthChange?.(start, end);
  }

  function prevMonth() {
    const newMonth = month === 0 ? 11 : month - 1;
    const newYear = month === 0 ? year - 1 : year;
    setMonth(newMonth);
    setYear(newYear);
    notifyMonth(newYear, newMonth);
  }

  function nextMonth() {
    const newMonth = month === 11 ? 0 : month + 1;
    const newYear = month === 11 ? year + 1 : year;
    setMonth(newMonth);
    setYear(newYear);
    notifyMonth(newYear, newMonth);
  }

  function goToToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    notifyMonth(today.getFullYear(), today.getMonth());
  }

  const eventsByDate = new Map<string, ICalendarEvent[]>();
  for (const event of events) {
    const key = event.calendarDate ?? event.date.slice(0, 10);
    const list = eventsByDate.get(key) ?? [];
    list.push(event);
    eventsByDate.set(key, list);
  }

  for (const list of eventsByDate.values()) {
    list.sort((left, right) => {
      if (left.isAllDay !== right.isAllDay) return left.isAllDay ? -1 : 1;
      return new Date(left.date).getTime() - new Date(right.date).getTime();
    });
  }

  const cells: { day: number | null; date: Date | null; key: string }[] = [];
  for (let i = 0; i < rows * 7; i++) {
    const dayNum = i - startDow + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push({ day: null, date: null, key: `blank-${year}-${month}-${i}` });
    } else {
      cells.push({
        day: dayNum,
        date: new Date(year, month, dayNum),
        key: `${year}-${month}-${dayNum}`,
      });
    }
  }

  const isCurrentMonth =
    year === today.getFullYear() && month === today.getMonth();

  return (
    <div className="flex flex-col gap-3 max-w-5xl w-full mx-auto px-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <div className="justify-self-start" />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" onClick={prevMonth}>
            <ChevronLeft />
          </Button>
          <h2 className="text-lg font-semibold min-w-40 text-center">
            {MONTHS[month]} {year}
          </h2>
          <Button variant="ghost" size="icon-xs" onClick={nextMonth}>
            <ChevronRight />
          </Button>
        </div>
        <div className="justify-self-end">
          {!isCurrentMonth && (
            <Button variant="outline" size="xs" onClick={goToToday}>
              Today
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto border border-b-0 rounded-lg">
        <div
          className="grid min-w-140"
          style={{ gridTemplateColumns: "repeat(7, 1fr)" }}
        >
          {DAYS.map((day, index) => (
            <div
              key={day}
              className={cn(
                "border-b border-r p-2 text-center font-medium text-sm",
                index === 6 && "border-r-0",
              )}
            >
              {day}
            </div>
          ))}

          {cells.map((cell) => {
            const isToday = cell.date !== null && isSameDay(cell.date, today);
            const dateKey = cell.date
              ? `${cell.date.getFullYear()}-${String(cell.date.getMonth() + 1).padStart(2, "0")}-${String(cell.date.getDate()).padStart(2, "0")}`
              : null;
            const dayEvents = dateKey ? (eventsByDate.get(dateKey) ?? []) : [];

            return (
              <div
                key={cell.key}
                className={cn(
                  "relative border-b border-r aspect-square p-1.5 text-left transition-colors overflow-hidden flex flex-col gap-1 pt-8",
                  "last:border-r-0 nth-[7n]:border-r-0",
                  cell.day === null
                    ? "bg-muted/30 cursor-default"
                    : "hover:bg-accent/20 cursor-pointer",
                )}
              >
                {cell.day !== null && (
                  <>
                    <button
                      type="button"
                      className="absolute inset-0 z-0 text-left"
                      onClick={() => cell.date && onDayClick?.(cell.date)}
                      aria-label={`Open ${dateKey}`}
                    />
                    <span
                      className={cn(
                        "pointer-events-none z-10 inline-flex items-center justify-center text-xs leading-none absolute top-1 right-1",
                        isToday &&
                          "bg-accent-strong text-background rounded-full size-5 font-bold",
                      )}
                    >
                      {cell.day}
                    </span>

                    {dayEvents.length > 0 && (
                      <div className="flex flex-col gap-0.5 overflow-hidden min-w-0 w-full">
                        {dayEvents.slice(0, 5).map((event) => (
                          <button
                            type="button"
                            key={event._id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onEventClick?.(event);
                            }}
                            className={cn(
                              "relative z-10 text-[10px] leading-tight text-left rounded px-1 py-0.5 transition-opacity hover:opacity-80 overflow-hidden text-ellipsis whitespace-nowrap min-w-0",
                              eventKindClass(event),
                              event.status === "completed" &&
                                "bg-accent text-accent-strong line-through opacity-60",
                              event.status === "canceled" &&
                                "bg-muted text-foreground line-through opacity-40",
                              event.status === "scheduled" &&
                                "bg-accent-strong text-background",
                            )}
                          >
                            <span className="opacity-70">
                              {event.isAllDay
                                ? "All day"
                                : formatEventTime(event.date)}
                            </span>{" "}
                            {event.title}
                          </button>
                        ))}
                        {dayEvents.length > 5 && (
                          <span className="text-[10px] text-muted-foreground px-1">
                            +{dayEvents.length - 5} more
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
    </div>
  );
}
