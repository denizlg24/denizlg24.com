"use client";

import { HoursApp } from "@repo/admin/hours/hours-app";
import { AdminProvider } from "@repo/admin/provider";
import { Skeleton } from "@repo/ui/skeleton";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function HoursRoute() {
  const { value, loading } = useDesktopAdmin();
  return (
    <AdminProvider value={value}>
      {loading ? (
        <div className="space-y-4 p-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mx-auto size-44 rounded-full" />
        </div>
      ) : (
        <HoursApp />
      )}
    </AdminProvider>
  );
}
