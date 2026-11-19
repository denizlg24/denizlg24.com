import { type NextRequest, NextResponse } from "next/server";
import { preferMarketData } from "@/lib/markets/data";
import { parseLimit } from "@/lib/markets/route-params";
import { searchSymbols } from "@/lib/markets/service";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) return NextResponse.json({ results: [] });

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"), 20, 50);
  if (query.length > 100) {
    return NextResponse.json({ error: "Query is too long" }, { status: 400 });
  }
  try {
    const data = await preferMarketData(
      (client) => client.search(query, limit),
      async () => ({ results: await searchSymbols(query, limit) }),
    );
    return NextResponse.json(data);
  } catch (error) {
    console.error("[markets] Search failed", error);
    return NextResponse.json(
      { error: "Symbol search unavailable" },
      { status: 502 },
    );
  }
}
