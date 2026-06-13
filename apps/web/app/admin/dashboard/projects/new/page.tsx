import { Button } from "@repo/ui/button";
import { ArrowLeft, FolderGit2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/require-admin";
import { AdminPageHeader } from "../../_components/admin-page-header";
import { ProjectForm } from "../_components/project-form";

export default async function NewProjectPage() {
  const session = await getAdminSession();

  if (!session) {
    redirect("/auth/login");
  }

  return (
    <div className="flex flex-col gap-3">
      <AdminPageHeader
        icon={<FolderGit2 className="size-4 text-muted-foreground" />}
        title="Create Project"
        leading={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/dashboard/projects">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Link>
          </Button>
        }
      />
      <ProjectForm mode="create" />
    </div>
  );
}
