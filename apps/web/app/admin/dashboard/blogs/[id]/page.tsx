import { Button } from "@repo/ui/button";
import { ArrowLeft, Notebook } from "lucide-react";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { getBlogById } from "@/lib/blog";
import { getAdminSession } from "@/lib/require-admin";
import { AdminPageHeader } from "../../_components/admin-page-header";
import { BlogForm } from "../_components/blog-form";

export default async function EditBlogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAdminSession();

  if (!session) {
    forbidden();
  }

  const { id } = await params;
  const blog = await getBlogById(id);

  if (!blog) {
    notFound();
  }

  return (
    <div className="w-full flex flex-col gap-3">
      <AdminPageHeader
        icon={<Notebook className="size-4 text-muted-foreground" />}
        title="Edit Blog Post"
        leading={
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin/dashboard/blogs">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
        }
      />
      <BlogForm mode="edit" blog={blog} />
    </div>
  );
}
