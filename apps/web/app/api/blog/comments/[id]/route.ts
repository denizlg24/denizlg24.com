import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { BlogComment } from "@/models/BlogComment";

function isValidObjectId(id: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(id);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    if (!id || !isValidObjectId(id)) {
      return NextResponse.json(
        { error: "Invalid comment ID" },
        { status: 400 },
      );
    }

    await connectDB();

    const comment = await BlogComment.findById(id);
    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    const hasReplies = await BlogComment.exists({ commentId: id });

    if (hasReplies) {
      await BlogComment.findByIdAndUpdate(id, {
        isDeleted: true,
        content: "[deleted]",
        authorName: "[deleted]",
      });

      return NextResponse.json(
        { message: "Comment soft deleted", softDeleted: true },
        { status: 200 },
      );
    } else {
      await BlogComment.findByIdAndDelete(id);

      return NextResponse.json(
        { message: "Comment deleted", softDeleted: false },
        { status: 200 },
      );
    }
  } catch (error) {
    console.error("Error deleting comment:", error);
    return NextResponse.json(
      { error: "Failed to delete comment" },
      { status: 500 },
    );
  }
}
