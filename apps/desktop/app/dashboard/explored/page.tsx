"use client";

import { ExploredMap } from "@repo/admin/location/explored-map";
import { AdminProvider } from "@repo/admin/provider";
import { Skeleton } from "@repo/ui/skeleton";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function ExploredRoute() {
  const { value, loading } = useDesktopAdmin();
  return (
    <AdminProvider value={value}>
      <div className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <div className="flex-1 p-4">
            <Skeleton className="h-full w-full rounded-md" />
          </div>
        ) : (
          <ExploredMap />
        )}
      </div>
    </AdminProvider>
  );
}
