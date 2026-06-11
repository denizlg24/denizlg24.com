import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getBlogById } from "@/lib/blog";
import { getAdminSession } from "@/lib/require-admin";
import { CommentsList } from "../../_components/comments-list";

export default async function BlogCommentsPage({
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
    <div className="flex flex-col gap-6">
      <div className="flex sm:flex-row flex-col sm:items-center items-start gap-4 justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin/dashboard/blogs">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Manage Comments</h1>
            <p className="text-muted-foreground">{blog.title}</p>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/blog/${blog.slug}`} target="_blank">
            <ExternalLink className="w-4 h-4" />
            View Post
          </Link>
        </Button>
      </div>

      <CommentsList blogId={blog._id} />
    </div>
  );
}
