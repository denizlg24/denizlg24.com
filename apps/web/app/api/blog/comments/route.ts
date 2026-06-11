import { ipAddress } from "@vercel/functions";
import { type NextRequest, NextResponse } from "next/server";
import { sendToSlack } from "@/lib/comments";
import { connectDB } from "@/lib/mongodb";
import { checkRateLimit } from "@/lib/rate-limit";
import { Blog } from "@/models/Blog";
import { BlogComment } from "@/models/BlogComment";

function sanitizeString(str: string): string {
  return str
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .trim();
}

function isValidObjectId(id: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(id);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const blogId = searchParams.get("blogId");
    const parentId = searchParams.get("parentId");
    const sessionId = searchParams.get("sessionId");

    if (!blogId) {
      return NextResponse.json(
        { error: "Blog ID is required" },
        { status: 400 },
      );
    }

    if (!isValidObjectId(blogId)) {
      return NextResponse.json(
        { error: "Invalid blog ID format" },
        { status: 400 },
      );
    }

    if (parentId && !isValidObjectId(parentId)) {
      return NextResponse.json(
        { error: "Invalid parent comment ID format" },
        { status: 400 },
      );
    }

    await connectDB();

    const baseQuery: Record<string, unknown> = {
      blogId,
      isDeleted: { $ne: true },
    };

    if (parentId) {
      baseQuery.commentId = parentId;
    } else {
      baseQuery.commentId = { $exists: false };
    }

    let query: Record<string, unknown>;
    if (sessionId) {
      query = {
        ...baseQuery,
        $or: [{ isApproved: true }, { sessionId: sessionId }],
      };
    } else {
      query = {
        ...baseQuery,
        isApproved: true,
      };
    }

    const comments = await BlogComment.find(query)
      .sort({ createdAt: parentId ? 1 : -1 })
      .limit(200)
      .lean();

    const formattedComments = comments.map((comment) => ({
      ...comment,
      _id: comment._id.toString(),
      sessionId:
        comment.sessionId === sessionId ? comment.sessionId : undefined,
    }));

    return NextResponse.json({ comments: formattedComments }, { status: 200 });
  } catch (error) {
    console.error("Error fetching comments:", error);
    return NextResponse.json(
      { error: "Failed to fetch comments" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const _ipAddress = ipAddress(request) || "unknown";
    const { allowed, resetMs } = await checkRateLimit(`comment:${_ipAddress}`, {
      maxRequests: 10,
      windowMs: 60_000,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many submissions. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) },
        },
      );
    }

    const { blogId, commentId, authorName, content, sessionId } = body;

    if (typeof blogId !== "string" || typeof content !== "string") {
      return NextResponse.json(
        { error: "Invalid request data" },
        { status: 400 },
      );
    }

    if (typeof authorName !== "string") {
      return NextResponse.json(
        { error: "Invalid author data" },
        { status: 400 },
      );
    }

    const sanitizedContent = sanitizeString(content);
    const sanitizedAuthorName = sanitizeString(authorName);

    if (!blogId || !sanitizedContent) {
      return NextResponse.json(
        { error: "Blog ID and content are required" },
        { status: 400 },
      );
    }

    if (!sanitizedAuthorName) {
      return NextResponse.json(
        { error: "Author name is required" },
        { status: 400 },
      );
    }

    if (!isValidObjectId(blogId)) {
      return NextResponse.json(
        { error: "Invalid blog ID format" },
        { status: 400 },
      );
    }

    if (
      commentId &&
      (typeof commentId !== "string" || !isValidObjectId(commentId))
    ) {
      return NextResponse.json(
        { error: "Invalid comment ID format" },
        { status: 400 },
      );
    }

    if (sanitizedAuthorName.length > 100) {
      return NextResponse.json(
        { error: "Author name is too long (max 100 characters)" },
        { status: 400 },
      );
    }

    if (sanitizedContent.length > 5000) {
      return NextResponse.json(
        { error: "Comment is too long (max 5000 characters)" },
        { status: 400 },
      );
    }

    if (sanitizedContent.length < 2) {
      return NextResponse.json(
        { error: "Comment is too short (min 2 characters)" },
        { status: 400 },
      );
    }

    await connectDB();

    const comment = await BlogComment.create({
      blogId,
      commentId: commentId || undefined,
      authorName: sanitizedAuthorName,
      content: sanitizedContent,
      sessionId: typeof sessionId === "string" ? sessionId : undefined,
    });

    const blog = await Blog.findById(blogId).select("title slug").lean();

    await sendToSlack({
      comment: {
        _id: comment._id.toString(),
        blogId,
        commentId,
        authorName: sanitizedAuthorName,
        content: sanitizedContent,
        isApproved: false,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      blogTitle: blog?.title,
      blogSlug: blog?.slug,
    });

    return NextResponse.json(
      {
        message: "Comment submitted successfully.",
        comment: {
          ...comment.toObject(),
          _id: comment._id.toString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating comment:", error);
    return NextResponse.json(
      { error: "Failed to submit comment" },
      { status: 500 },
    );
  }
}
