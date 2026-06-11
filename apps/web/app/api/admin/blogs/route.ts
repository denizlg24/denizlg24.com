import { type NextRequest, NextResponse } from "next/server";
import { getAllBlogs } from "@/lib/blog";
import { connectDB } from "@/lib/mongodb";
import { revalidateBlogContent } from "@/lib/public-content-revalidation";
import { requireAdmin } from "@/lib/require-admin";
import { calculateReadingTime, string_to_slug } from "@/lib/utils";
import { Blog } from "@/models/Blog";

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
    const { title, excerpt, media, content, tags, isActive } = body;

    await connectDB();

    const timeToRead = calculateReadingTime(content || "");

    const blog = await Blog.create({
      title,
      slug: string_to_slug(title),
      excerpt,
      media: media || [],
      content: content || "",
      timeToRead,
      tags: tags || [],
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
