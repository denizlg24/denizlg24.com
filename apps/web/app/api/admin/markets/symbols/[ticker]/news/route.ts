import { type NextRequest, NextResponse } from "next/server";
import { getNews } from "@/lib/markets/service";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { ticker } = await params;
  const limit = Math.min(
    Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20,
    100,
  );

  try {
    return NextResponse.json(await getNews(ticker, limit));
  } catch (error) {
    console.error("[markets] News fetch failed", error);
    return NextResponse.json({ error: "News fetch failed" }, { status: 502 });
  }
}
