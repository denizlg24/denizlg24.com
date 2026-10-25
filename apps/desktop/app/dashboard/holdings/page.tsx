"use client";

import { HoldingsPage } from "@repo/admin/brokerage/holdings-page";
import { AdminProvider } from "@repo/admin/provider";
import { Skeleton } from "@repo/ui/skeleton";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function HoldingsRoute() {
  const { value, loading } = useDesktopAdmin();
  return (
    <AdminProvider value={value}>
      {loading ? (
        <div className="space-y-4 p-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-52 w-full" />
        </div>
      ) : (
        <HoldingsPage />
      )}
    </AdminProvider>
  );
}
