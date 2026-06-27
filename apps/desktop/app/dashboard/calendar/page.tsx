"use client";

import { CalendarPage } from "@repo/admin/calendar/calendar-page";
import { AdminProvider } from "@repo/admin/provider";
import { Loader2 } from "lucide-react";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function CalendarRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <CalendarPage />
      )}
    </AdminProvider>
  );
}
