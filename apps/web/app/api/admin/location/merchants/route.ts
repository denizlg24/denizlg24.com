import type { LocationMerchantsResponse } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { getBudgetSnapshot } from "@/lib/finance/budget-overview";
import { merchantTokens } from "@/lib/location-brief";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  await connectDB();
  const snapshot = await getBudgetSnapshot(new Date());
  const body: LocationMerchantsResponse = { tokens: merchantTokens(snapshot) };
  return NextResponse.json(body);
}
