import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getBlogById } from "@/lib/blog";
import { getAdminSession } from "@/lib/require-admin";
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
    <div className="w-full flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/dashboard/blogs">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <h1 className="text-2xl sm:text-3xl font-bold">Edit Blog Post</h1>
      </div>

      <BlogForm mode="edit" blog={blog} />
    </div>
  );
}
