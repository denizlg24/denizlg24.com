import type { NextRequest } from "next/server";
import { marketData, marketDataErrorResponse } from "@/lib/markets/data";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const client = marketData();
    if (client) return Response.json(await client.macroCatalog());
  } catch (error) {
    return marketDataErrorResponse(error);
  }
  return Response.json(
    { error: "Markets data is not configured" },
    { status: 503 },
  );
}
