import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getAdminSession } from "@/lib/require-admin";
import { TimelineForm } from "../_components/timeline-form";

export default async function NewTimelinePage() {
  const session = await getAdminSession();

  if (!session) {
    forbidden();
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
            Create Timeline Item
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Add a new timeline card to display on your homepage.
          </p>
        </div>
      </div>

      <div className="bg-background">
        <TimelineForm mode="create" />
      </div>
    </>
  );
}
