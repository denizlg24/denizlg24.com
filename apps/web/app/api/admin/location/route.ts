import { type NextRequest, NextResponse } from "next/server";
import { getCurrentLocation } from "@/lib/location";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  return NextResponse.json(await getCurrentLocation());
}
