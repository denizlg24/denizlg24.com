import { ipAddress } from "@vercel/functions";
import { type NextRequest, NextResponse } from "next/server";
import {
  getAllBlogViews,
  getBlogViewCount,
  incrementBlogViewCount,
} from "@/lib/blog";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const blogId = searchParams.get("blogId");

    if (!blogId) {
      const viewsMap = await getAllBlogViews();
      return NextResponse.json({ views: viewsMap }, { status: 200 });
    }

    const views = await getBlogViewCount(blogId);

    return NextResponse.json({ views }, { status: 200 });
  } catch (error) {
    console.error("Error fetching blog views:", error);
    return NextResponse.json(
      { error: "Failed to fetch views" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const _ipAddress = ipAddress(request) || "unknown";
    const { allowed, resetMs } = await checkRateLimit(`view:${_ipAddress}`, {
      maxRequests: 10,
      windowMs: 60_000,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) },
        },
      );
    }

    const { blogId } = await request.json();

    if (!blogId) {
      return NextResponse.json(
        { error: "Blog ID is required" },
        { status: 400 },
      );
    }

    const views = await incrementBlogViewCount(blogId);

    return NextResponse.json({ views }, { status: 200 });
  } catch (error) {
    console.error("Error incrementing blog views:", error);
    return NextResponse.json(
      { error: "Failed to increment views" },
      { status: 500 },
    );
  }
}
