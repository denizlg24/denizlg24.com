"use client";

import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AddEventDialog } from "./_components/add-event-dialog";
import { Calendar } from "./_components/calendar";
import { CalendarProvider, useCalendar } from "./_components/calendar-context";
import { TodaysDate } from "./_components/todays-date";
import { TodaysEvents } from "./_components/todays-events";

function AddEventDialogWithContext() {
  const { refreshEvents } = useCalendar();
  return <AddEventDialog onEventCreated={refreshEvents} />;
}

export default function CalendarPage() {
  return (
    <CalendarProvider>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Calendar Events</h1>
            <p className="text-sm sm:text-base text-muted-foreground">
              View and manage calendar events
            </p>
          </div>
        </div>

        <Calendar />
        <AddEventDialogWithContext />
        <div className="p-3 rounded-lg border shadow-xs w-full space-y-4">
          <h2 className="text-base sm:text-lg font-medium w-full border-b pb-2">
            Events Today - <span></span>
            <Suspense
              fallback={
                <Skeleton className="ml-1 w-24 h-5 rounded-full inline-flex" />
              }
            >
              <span className="text-muted-foreground text-xs sm:text-sm font-normal">
                <TodaysDate formatter="dd/MM/yyyy" />
              </span>
            </Suspense>
          </h2>
          <div className="w-full flex flex-col gap-2 overflow-y-auto max-h-100">
            <TodaysEvents />
          </div>
        </div>
      </div>
    </CalendarProvider>
  );
}
