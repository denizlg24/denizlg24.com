import { type NextRequest, NextResponse } from "next/server";
import { getFilteredActiveBlogs } from "@/lib/blog";
import { requireAdmin } from "@/lib/require-admin";

/** Published posts matching a query and/or tags, as the public listing filters them. */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const search = request.nextUrl.searchParams;
  try {
    const blogs = await getFilteredActiveBlogs({
      query: search.get("q")?.trim() ?? "",
      tags: search.getAll("tags").filter(Boolean),
    });
    return NextResponse.json({
      blogs: blogs.map((blog) => ({
        _id: blog._id,
        title: blog.title,
        slug: blog.slug,
        excerpt: blog.excerpt,
        tags: blog.tags,
        timeToRead: blog.timeToRead,
      })),
    });
  } catch (error) {
    console.error("Error searching blogs:", error);
    return NextResponse.json(
      { error: "Failed to search blogs" },
      { status: 500 },
    );
  }
}
