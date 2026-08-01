import { type NextRequest, NextResponse } from "next/server";
import {
  getSymbolDetail,
  MarketsNotConfiguredError,
} from "@/lib/markets/service";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { ticker } = await params;
  try {
    const detail = await getSymbolDetail(ticker);
    if (!detail.symbol && !detail.stale) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof MarketsNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[markets] Symbol lookup failed", error);
    return NextResponse.json(
      { error: "Symbol lookup failed" },
      { status: 502 },
    );
  }
}
