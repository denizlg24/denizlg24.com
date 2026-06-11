"use client";

import { ArrowLeft, FolderGit2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import { ProjectForm } from "../_components/project-form";

export default function NewProjectPage() {
  const { settings, loading: loadingSettings } = useUserSettings();
  const router = useRouter();

  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  if (loadingSettings || !api) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
          <Link href="/dashboard/projects">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <FolderGit2 className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">New Project</span>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-4">
          <ProjectForm
            mode="create"
            api={api}
            onSuccess={() => router.push("/dashboard/projects")}
            onCancel={() => router.push("/dashboard/projects")}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
