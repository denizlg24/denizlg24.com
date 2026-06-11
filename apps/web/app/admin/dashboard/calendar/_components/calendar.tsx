"use client";

import {
  addMonths,
  format,
  getDay,
  getDaysInMonth,
  isBefore,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCalendar } from "./calendar-context";
import { CalendarDayDialog } from "./calendar-day-dialog";

export function Calendar() {
  const { currentMonth, setCurrentMonth, getEventsForDay, refreshEvents } =
    useCalendar();

  const month = currentMonth.getMonth();
  const year = currentMonth.getFullYear();
  const days = getDaysInMonth(currentMonth);

  const handlePrevMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  return (
    <div className="w-full flex flex-col gap-2 items-center">
      <div className="mx-auto flex flex-row items-center justify-between gap-2 w-52">
        <Button onClick={handlePrevMonth} size="icon-sm" variant="ghost">
          <ChevronLeft />
        </Button>
        <p className="text-center text-sm font-semibold">
          {format(currentMonth, "MMMM yyyy")}
        </p>
        <Button onClick={handleNextMonth} size="icon-sm" variant="ghost">
          <ChevronRight />
        </Button>
      </div>
      <div className="w-full grid grid-cols-7 gap-0 max-w-4xl mx-auto">
        {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((day) => (
          <p
            key={day}
            className="text-center xs:text-sm text-xs font-semibold my-4 xs:scale-95 scale-75"
          >
            {day}
          </p>
        ))}
        {Array.from({ length: getDay(new Date(year, month, 1)) }, (_, i) => (
          <div
            key={`${i}empty`}
            className="bg-surface w-full col-span-1 aspect-square h-auto border"
          ></div>
        ))}

        {Array.from({ length: days }).map((_, i) => {
          const dayDate = new Date(year, month, i + 1);
          const dayEvents = getEventsForDay(dayDate);
          const eventCount = dayEvents.length;

          return isBefore(new Date(year, month, i + 2), new Date()) ? (
            <div
              key={i}
              className="border bg-surface/30 p-1.5 w-full col-span-1 aspect-square h-auto relative shadow-sm overflow-hidden"
            >
              <span className="absolute xs:top-1 top-0 xs:left-1 left-0.5 text-xs font-semibold text-foreground/50 lg:scale-100 xs:scale-75 scale-65">
                {i + 1}
              </span>
              {eventCount > 0 && (
                <div className="absolute bottom-0 left-0 right-0 p-0.5 xs:p-1 space-y-0.5 lg:scale-100 xs:scale-75 scale-65 origin-bottom-left">
                  {dayEvents.slice(0, 2).map((event) => (
                    <div
                      key={event._id}
                      className="flex items-center gap-1 text-xs leading-tight pl-1"
                    >
                      <div
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          event.status === "scheduled" && "bg-muted",
                          event.status === "completed" && "bg-accent-strong",
                          event.status === "canceled" && "bg-red-900",
                        )}
                      />
                      <span className="overflow-hidden whitespace-nowrap text-foreground/50 font-medium">
                        {event.title}
                      </span>
                    </div>
                  ))}
                  {eventCount > 2 && (
                    <div className="text-xs text-foreground/40 font-medium pl-2.5 whitespace-nowrap">
                      <span className="hidden xs:inline">
                        +{eventCount - 2} more
                      </span>
                      <span className="xs:hidden">+{eventCount - 2}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <CalendarDayDialog
              date={dayDate}
              key={`date${i}`}
              events={dayEvents}
              onEventChange={refreshEvents}
            />
          );
        })}
        {Array.from(
          { length: 6 - getDay(new Date(year, month, days)) },
          (_, i) => (
            <div
              key={`${i}empty-end`}
              className="bg-surface w-full col-span-1 aspect-square h-auto border"
            ></div>
          ),
        )}
      </div>
    </div>
  );
}
