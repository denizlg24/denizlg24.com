"use client";

import { Button } from "@repo/ui/button";
import { ScrollArea } from "@repo/ui/scroll-area";
import { ArrowLeft, Loader2, NotebookPen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import { BlogForm } from "../_components/blog-form";

export default function NewBlogPage() {
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
      <DashboardPageHeader
        leading={
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
            <Link href="/dashboard/blog">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
        }
        icon={<NotebookPen className="size-4 text-muted-foreground" />}
        title="New Post"
      />

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-4">
          <BlogForm
            mode="create"
            api={api}
            onSuccess={() => router.push("/dashboard/blog")}
            onCancel={() => router.push("/dashboard/blog")}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
