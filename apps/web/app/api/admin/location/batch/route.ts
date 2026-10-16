import { locationBatchInputSchema } from "@repo/schemas";
import { after, type NextRequest, NextResponse } from "next/server";
import { ingestLocationBatch } from "@/lib/location";
import { judgeVisitArrivals } from "@/lib/location-insight";
import { requireAdmin } from "@/lib/require-admin";

/** The phone's upload queue: points and visits, idempotent on their ids. */
export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = locationBatchInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid batch" },
      { status: 400 },
    );
  }
  const { arrivals, ...result } = await ingestLocationBatch(parsed.data);
  if (arrivals.length) {
    after(() => judgeVisitArrivals(arrivals));
  }
  return NextResponse.json(result);
}
