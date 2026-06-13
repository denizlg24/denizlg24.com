import { Button } from "@repo/ui/button";
import { ArrowLeft, Briefcase } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminSession } from "@/lib/require-admin";
import { getTimelineItemById } from "@/lib/timeline";
import { AdminPageHeader } from "../../../_components/admin-page-header";
import { TimelineForm } from "../../_components/timeline-form";

export default async function EditTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAdminSession();

  if (!session) {
    redirect("/auth/login");
  }

  const { id } = await params;

  const item = await getTimelineItemById(id);

  if (!item) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-3">
      <AdminPageHeader
        icon={<Briefcase className="size-4 text-muted-foreground" />}
        title="Edit Timeline Item"
        leading={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/dashboard/timeline">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Link>
          </Button>
        }
      />

      <div className="bg-background">
        <TimelineForm mode="edit" initialData={item} />
      </div>
    </div>
  );
}
