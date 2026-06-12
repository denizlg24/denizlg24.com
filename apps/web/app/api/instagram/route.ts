import { NextResponse } from "next/server";
import { getAllInstagramPosts } from "@/lib/instagram_posts";

export const dynamic = "force-dynamic";

const WEEK_IN_SECONDS = 60 * 60 * 24 * 7;
const MONTH_IN_SECONDS = 60 * 60 * 24 * 30;

export async function GET() {
  try {
    const posts = await getAllInstagramPosts();
    return NextResponse.json(posts, {
      headers: {
        "Cache-Control": `public, max-age=${WEEK_IN_SECONDS}, stale-while-revalidate=${MONTH_IN_SECONDS}`,
        "CDN-Cache-Control": `public, s-maxage=${WEEK_IN_SECONDS}, stale-while-revalidate=${MONTH_IN_SECONDS}`,
        "Vercel-CDN-Cache-Control": `public, s-maxage=${WEEK_IN_SECONDS}, stale-while-revalidate=${MONTH_IN_SECONDS}`,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Instagram is temporarily unavailable." },
      {
        headers: { "Cache-Control": "no-store" },
        status: 503,
      },
    );
  }
}
