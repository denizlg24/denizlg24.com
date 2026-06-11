import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAllComments, getCommentStats } from "@/lib/comments";
import { getAdminSession } from "@/lib/require-admin";
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
    <div className="flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">Comment Moderation</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Review and moderate blog comments
        </p>
      </div>

      <CommentsWrapper initialComments={comments} initialStats={stats} />
    </div>
  );
}
