"use client";

import { AdminProvider } from "@repo/admin/provider";
import { TimelineForm } from "@repo/admin/timeline/timeline-form";
import { Button } from "@repo/ui/button";
import { ScrollArea } from "@repo/ui/scroll-area";
import { ArrowLeft, Briefcase, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function NewTimelinePage() {
  const { value, loading } = useDesktopAdmin();
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <AdminProvider value={value}>
      <div className="flex flex-col h-full">
        <DashboardPageHeader
          leading={
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
              <Link href="/dashboard/timeline">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
          }
          icon={<Briefcase className="size-4 text-muted-foreground" />}
          title="New Timeline Item"
        />
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-4 py-4">
            <TimelineForm
              mode="create"
              onSuccess={() => router.push("/dashboard/timeline")}
              onCancel={() => router.push("/dashboard/timeline")}
            />
          </div>
        </ScrollArea>
      </div>
    </AdminProvider>
  );
}
