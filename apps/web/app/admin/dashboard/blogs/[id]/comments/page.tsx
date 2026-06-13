import { Button } from "@repo/ui/button";
import { ArrowLeft, ExternalLink, MessageSquare } from "lucide-react";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { getBlogById } from "@/lib/blog";
import { getAdminSession } from "@/lib/require-admin";
import { AdminPageHeader } from "../../../_components/admin-page-header";
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
    <div className="flex flex-col gap-3">
      <AdminPageHeader
        icon={<MessageSquare className="size-4 text-muted-foreground" />}
        title="Manage Comments"
        leading={
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin/dashboard/blogs">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
        }
      >
        <Button variant="outline" asChild>
          <Link href={`/blog/${blog.slug}`} target="_blank">
            <ExternalLink className="w-4 h-4" />
            View Post
          </Link>
        </Button>
      </AdminPageHeader>
      <CommentsList blogId={blog._id} />
    </div>
  );
}
