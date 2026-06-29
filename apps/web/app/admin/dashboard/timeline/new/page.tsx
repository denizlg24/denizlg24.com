"use client";

import { TimelineForm } from "@repo/admin/timeline/timeline-form";
import { Button } from "@repo/ui/button";
import { PageHeader } from "@repo/ui/page-header";
import { ScrollArea } from "@repo/ui/scroll-area";
import { ArrowLeft, Briefcase } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function NewTimelinePage() {
  const router = useRouter();

  return (
    <AdminFeatureShell>
      <div className="flex flex-col h-full">
        <PageHeader
          leading={
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
              <Link href="/admin/dashboard/timeline">
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
              onSuccess={() => router.push("/admin/dashboard/timeline")}
              onCancel={() => router.push("/admin/dashboard/timeline")}
            />
          </div>
        </ScrollArea>
      </div>
    </AdminFeatureShell>
  );
}
