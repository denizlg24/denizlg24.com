"use client";

import { Skeleton } from "@repo/ui/skeleton";
import { CalendarDays } from "lucide-react";
import { Suspense } from "react";
import { AdminPageHeader } from "../_components/admin-page-header";
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
      <div className="flex flex-col gap-3">
        <AdminPageHeader
          icon={<CalendarDays className="size-4 text-muted-foreground" />}
          title="Calendar Events"
        />
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
