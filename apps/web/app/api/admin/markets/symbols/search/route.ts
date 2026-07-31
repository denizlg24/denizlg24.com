import { type NextRequest, NextResponse } from "next/server";
import { searchSymbols } from "@/lib/markets/service";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) return NextResponse.json({ results: [] });

  const limit = Math.min(
    Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20,
    50,
  );
  return NextResponse.json({ results: await searchSymbols(query, limit) });
}
