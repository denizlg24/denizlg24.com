import { type NextRequest, NextResponse } from "next/server";
import { getBudgets } from "@/lib/markets/service";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  return NextResponse.json(await getBudgets());
}
