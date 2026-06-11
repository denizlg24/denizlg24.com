import { blogUpdateSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { getBlogById, toggleBlogActive } from "@/lib/blog";
import { connectDB } from "@/lib/mongodb";
import { revalidateBlogContent } from "@/lib/public-content-revalidation";
import { requireAdmin } from "@/lib/require-admin";
import { calculateReadingTime } from "@/lib/utils";
import { Blog } from "@/models/Blog";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const blog = await getBlogById(id);

    if (!blog) {
      return NextResponse.json({ error: "Blog not found" }, { status: 404 });
    }

    return NextResponse.json({ blog }, { status: 200 });
  } catch (error) {
    console.error("Error fetching blog:", error);
    return NextResponse.json(
      { error: "Failed to fetch blog" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    if (body.toggleActive) {
      const blog = await toggleBlogActive(id);
      if (!blog) {
        return NextResponse.json({ error: "Blog not found" }, { status: 404 });
      }
      revalidateBlogContent();
      return NextResponse.json(
        { message: "Blog visibility toggled successfully", blog },
        { status: 200 },
      );
    }
    await connectDB();

    const parsed = blogUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid update payload" },
        { status: 400 },
      );
    }
    const updateData: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.content !== undefined) {
      updateData.timeToRead = calculateReadingTime(parsed.data.content);
    }

    const blog = await Blog.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    })
      .lean()
      .exec();

    if (!blog) {
      return NextResponse.json({ error: "Blog not found" }, { status: 404 });
    }
    revalidateBlogContent();
    return NextResponse.json(
      {
        message: "Blog updated successfully",
        blog: {
          ...blog,
          _id: blog._id.toString(),
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error updating blog:", error);
    return NextResponse.json(
      { error: "Failed to update blog" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    await connectDB();
    const blog = await Blog.findByIdAndDelete(id);

    if (!blog) {
      return NextResponse.json({ error: "Blog not found" }, { status: 404 });
    }

    revalidateBlogContent();
    return NextResponse.json(
      { message: "Blog deleted successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error deleting blog:", error);
    return NextResponse.json(
      { error: "Failed to delete blog" },
      { status: 500 },
    );
  }
}
