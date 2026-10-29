"use client";

import { ExploredMap } from "@repo/admin/location/explored-map";
import { AdminProvider } from "@repo/admin/provider";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { Earth } from "lucide-react";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function ExploredRoute() {
  const { value, loading } = useDesktopAdmin();
  return (
    <AdminProvider value={value}>
      <div className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <Page>
            <PageHeader icon={<Earth />} title="Explored" />
            <PageBody bleed>
              <Skeleton className="absolute inset-0 rounded-none" />
            </PageBody>
          </Page>
        ) : (
          <ExploredMap />
        )}
      </div>
    </AdminProvider>
  );
}
