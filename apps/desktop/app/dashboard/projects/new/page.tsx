"use client";

import { ProjectForm } from "@repo/admin/projects/project-form";
import { AdminProvider } from "@repo/admin/provider";
import { Button } from "@repo/ui/button";
import { ScrollArea } from "@repo/ui/scroll-area";
import { ArrowLeft, FolderGit2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function NewProjectPage() {
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
              <Link href="/dashboard/projects">
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
              onSuccess={() => router.push("/dashboard/projects")}
              onCancel={() => router.push("/dashboard/projects")}
            />
          </div>
        </ScrollArea>
      </div>
    </AdminProvider>
  );
}
