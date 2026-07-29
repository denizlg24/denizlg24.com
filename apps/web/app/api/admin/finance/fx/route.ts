import { financeFxSnapshotSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { upsertFinanceFxSnapshot } from "@/lib/finance/operations";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = financeFxSnapshotSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid FX snapshot" }, { status: 400 });
  }
  await upsertFinanceFxSnapshot(parsed.data);
  return NextResponse.json({ success: true }, { status: 201 });
}
