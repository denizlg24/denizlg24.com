"use client";

import { BlogForm } from "@repo/admin/blog/blog-form";
import { Button } from "@repo/ui/button";
import { PageHeader } from "@repo/ui/page-header";
import { ScrollArea } from "@repo/ui/scroll-area";
import { ArrowLeft, NotebookPen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function NewBlogPage() {
  const router = useRouter();

  return (
    <AdminFeatureShell>
      <div className="flex flex-col h-full">
        <PageHeader
          leading={
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
              <Link href="/admin/dashboard/blogs">
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
              onSuccess={() => router.push("/admin/dashboard/blogs")}
              onCancel={() => router.push("/admin/dashboard/blogs")}
            />
          </div>
        </ScrollArea>
      </div>
    </AdminFeatureShell>
  );
}
