import { Button } from "@repo/ui/button";
import { ArrowLeft, Briefcase } from "lucide-react";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { getAdminSession } from "@/lib/require-admin";
import { AdminPageHeader } from "../../_components/admin-page-header";
import { TimelineForm } from "../_components/timeline-form";

export default async function NewTimelinePage() {
  const session = await getAdminSession();

  if (!session) {
    forbidden();
  }

  return (
    <div className="flex flex-col gap-3">
      <AdminPageHeader
        icon={<Briefcase className="size-4 text-muted-foreground" />}
        title="Create Timeline Item"
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
        <TimelineForm mode="create" />
      </div>
    </div>
  );
}
