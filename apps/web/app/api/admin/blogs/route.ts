import { type NextRequest, NextResponse } from "next/server";
import { getAllBlogs } from "@/lib/blog";
import { connectDB } from "@/lib/mongodb";
import { revalidateBlogContent } from "@/lib/public-content-revalidation";
import { requireAdmin } from "@/lib/require-admin";
import { computeTopicGroups } from "@/lib/tag-classify";
import { calculateReadingTime, string_to_slug } from "@/lib/utils";
import { Blog, type IBlogReference } from "@/models/Blog";

function sanitizeReferences(input: unknown): IBlogReference[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((ref) => ({
      label: typeof ref?.label === "string" ? ref.label.trim() : "",
      url: typeof ref?.url === "string" ? ref.url.trim() : "",
    }))
    .filter((ref) => ref.label && /^https?:\/\//i.test(ref.url));
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const blogs = await getAllBlogs();
    return NextResponse.json({ blogs }, { status: 200 });
  } catch (error) {
    console.error("Error fetching blogs:", error);
    return NextResponse.json(
      { error: "Failed to fetch blogs" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { title, excerpt, media, content, tags, references, isActive } = body;

    await connectDB();

    const timeToRead = calculateReadingTime(content || "");
    const finalTags: string[] = tags || [];
    const topicGroups = await computeTopicGroups(finalTags);

    const blog = await Blog.create({
      title,
      slug: string_to_slug(title),
      excerpt,
      media: media || [],
      content: content || "",
      timeToRead,
      tags: finalTags,
      topicGroups,
      references: sanitizeReferences(references),
      isActive: isActive !== undefined ? isActive : true,
    });
    revalidateBlogContent();
    return NextResponse.json(
      {
        message: "Blog created successfully",
        blog: {
          ...blog.toObject(),
          _id: blog._id.toString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating blog:", error);
    return NextResponse.json(
      { error: "Failed to create blog" },
      { status: 500 },
    );
  }
}
