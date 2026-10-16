import { locationRangeQuerySchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { listLocationVisits } from "@/lib/location";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = locationRangeQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid range" },
      { status: 400 },
    );
  }
  return NextResponse.json(await listLocationVisits(parsed.data));
}
