"use client";

import { ProjectForm } from "@repo/admin/projects/project-form";
import { Button } from "@repo/ui/button";
import { PageHeader } from "@repo/ui/page-header";
import { ScrollArea } from "@repo/ui/scroll-area";
import { ArrowLeft, FolderGit2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function NewProjectPage() {
  const router = useRouter();

  return (
    <AdminFeatureShell>
      <div className="flex flex-col h-full">
        <PageHeader
          leading={
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
              <Link href="/admin/dashboard/projects">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
          }
          icon={<FolderGit2 className="size-4 text-muted-foreground" />}
          title="New Project"
        />
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-4 py-4">
            <ProjectForm
              mode="create"
              onSuccess={() => router.push("/admin/dashboard/projects")}
              onCancel={() => router.push("/admin/dashboard/projects")}
            />
          </div>
        </ScrollArea>
      </div>
    </AdminFeatureShell>
  );
}
