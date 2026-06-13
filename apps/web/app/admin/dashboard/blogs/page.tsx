import { Button } from "@repo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/empty";
import { Notebook, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAllBlogs } from "@/lib/blog";
import { getAdminSession } from "@/lib/require-admin";
import { AdminPageHeader } from "../_components/admin-page-header";
import { BlogManager } from "./_components/blog-manager";

export default async function BlogsPage() {
  const session = await getAdminSession();

  if (!session) {
    redirect("/auth/login");
  }

  const blogs = await getAllBlogs();
  if (!blogs || blogs.length === 0) {
    return (
      <div className="w-full flex flex-col gap-3">
        <AdminPageHeader
          icon={<Notebook className="size-4 text-muted-foreground" />}
          title="Blogs"
        />
        <div>
          <Empty>
            <EmptyHeader className="max-w-lg!">
              <EmptyMedia variant="icon">
                <Notebook className="w-12 h-12 text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>No Blogs Yet</EmptyTitle>
              <EmptyDescription>
                You don't have any blogs yet. Create a new one to get started
                displaying your blogs.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link href="/admin/dashboard/blogs/new">
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
    <div className="mx-auto">
      <BlogManager initialBlogs={blogs} />
    </div>
  );
}
