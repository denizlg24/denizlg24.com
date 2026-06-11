import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getAdminSession } from "@/lib/require-admin";
import { getTimelineItemById } from "@/lib/timeline";
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
    <>
      <div className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/dashboard/timeline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Link>
        </Button>

        <div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">
            Edit Timeline Item
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Update your timeline card details.
          </p>
        </div>
      </div>

      <div className="bg-background">
        <TimelineForm mode="edit" initialData={item} />
      </div>
    </>
  );
}
