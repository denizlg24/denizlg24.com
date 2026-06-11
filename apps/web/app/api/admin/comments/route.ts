import { type NextRequest, NextResponse } from "next/server";
import { getAllComments, getCommentStats } from "@/lib/comments";
import { getAdminSession } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [comments, stats] = await Promise.all([
      getAllComments({ limit: 100 }),
      getCommentStats(),
    ]);

    return NextResponse.json({ comments, stats });
  } catch (error) {
    console.error("Error fetching comments:", error);
    return NextResponse.json(
      { error: "Failed to fetch comments" },
      { status: 500 },
    );
  }
}
