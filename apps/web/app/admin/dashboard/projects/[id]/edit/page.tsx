import { Button } from "@repo/ui/button";
import { ArrowLeft, FolderGit2 } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getProjectById } from "@/lib/projects";
import { getAdminSession } from "@/lib/require-admin";
import { AdminPageHeader } from "../../../_components/admin-page-header";
import { ProjectForm } from "../../_components/project-form";

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAdminSession();

  if (!session) {
    redirect("/auth/login");
  }

  const { id } = await params;
  const project = await getProjectById(id);

  if (!project) {
    notFound();
  }

  return (
    <div className="w-full flex flex-col gap-3">
      <AdminPageHeader
        icon={<FolderGit2 className="size-4 text-muted-foreground" />}
        title="Edit Project"
        leading={
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin/dashboard/projects">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
        }
      />
      <ProjectForm mode="edit" project={project} />
    </div>
  );
}
