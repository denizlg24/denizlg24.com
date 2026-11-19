import { isoDateSchema } from "@repo/markets/schemas";
import type { NextRequest } from "next/server";
import { marketData, marketDataErrorResponse } from "@/lib/markets/data";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ series: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { series } = await params;
  const from = request.nextUrl.searchParams.get("from") ?? undefined;
  const to = request.nextUrl.searchParams.get("to") ?? undefined;
  if (
    !/^[a-z0-9]{1,20}$/i.test(series) ||
    (from !== undefined && !isoDateSchema.safeParse(from).success) ||
    (to !== undefined && !isoDateSchema.safeParse(to).success) ||
    (from && to && from > to)
  ) {
    return Response.json(
      { error: "Invalid series or date range" },
      { status: 400 },
    );
  }

  try {
    const client = marketData();
    if (client)
      return Response.json(await client.macroHistory(series, { from, to }));
  } catch (error) {
    return marketDataErrorResponse(error);
  }
  return Response.json(
    { error: "Markets data is not configured" },
    { status: 503 },
  );
}
