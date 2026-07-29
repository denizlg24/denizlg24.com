import { financeMatchDecisionSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { after, type NextRequest, NextResponse } from "next/server";
import { resolveFinanceMatchReview } from "@/lib/finance/ledger";
import { observeFinanceMemorySafely } from "@/lib/finance/memory";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid match" }, { status: 400 });
  }
  const parsed = financeMatchDecisionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid match decision" },
      { status: 400 },
    );
  }
  await connectDB();
  const review = await resolveFinanceMatchReview(id, parsed.data.action);
  if (!review) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }
  after(() => observeFinanceMemorySafely());
  return NextResponse.json({ success: true });
}
