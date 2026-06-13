import { MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAllComments, getCommentStats } from "@/lib/comments";
import { getAdminSession } from "@/lib/require-admin";
import { AdminPageHeader } from "../_components/admin-page-header";
import { CommentsWrapper } from "./comments-wrapper";

export const metadata: Metadata = {
  title: "Comment Moderation | Admin Dashboard",
  description: "Moderate blog comments",
};

export const dynamic = "force-dynamic";

export default async function CommentsPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/auth/login");
  }

  const [comments, stats] = await Promise.all([
    getAllComments({ limit: 100 }),
    getCommentStats(),
  ]);

  return (
    <div className="flex flex-col gap-3">
      <AdminPageHeader
        icon={<MessageSquare className="size-4 text-muted-foreground" />}
        title="Comment Moderation"
      />
      <CommentsWrapper initialComments={comments} initialStats={stats} />
    </div>
  );
}
