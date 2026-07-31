import { type NextRequest, NextResponse } from "next/server";
import { getFilings, MarketsNotConfiguredError } from "@/lib/markets/service";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { ticker } = await params;
  const limit = Math.min(
    Number(request.nextUrl.searchParams.get("limit") ?? 40) || 40,
    200,
  );

  try {
    return NextResponse.json({ filings: await getFilings(ticker, limit) });
  } catch (error) {
    if (error instanceof MarketsNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[markets] Filing fetch failed", error);
    return NextResponse.json({ error: "Filing fetch failed" }, { status: 502 });
  }
}
