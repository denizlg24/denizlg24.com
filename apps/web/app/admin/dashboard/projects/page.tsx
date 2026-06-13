import { Button } from "@repo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/empty";
import { FolderGit2, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAllProjects } from "@/lib/projects";
import { getAdminSession } from "@/lib/require-admin";
import { AdminPageHeader } from "../_components/admin-page-header";
import { ProjectManager } from "./_components/project-manager";
export default async function ProjectsPage() {
  const session = await getAdminSession();

  if (!session) {
    redirect("/auth/login");
  }

  const projects = await getAllProjects();
  if (!projects || projects.length === 0) {
    return (
      <div className="w-full flex flex-col gap-3">
        <AdminPageHeader
          icon={<FolderGit2 className="size-4 text-muted-foreground" />}
          title="Projects"
        />
        <div>
          <Empty>
            <EmptyHeader className="max-w-lg!">
              <EmptyMedia variant="icon">
                <FolderGit2 className="w-12 h-12 text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>No Projects Yet</EmptyTitle>
              <EmptyDescription>
                You don't have any projects yet. Create a new one to get started
                displaying your projects.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link href="/admin/dashboard/projects/new">
                  <Plus className="w-4 h-4 mr-2" />
                  Create New
                </Link>
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto space-y-6">
      <ProjectManager initialProjects={projects} />
    </div>
  );
}
