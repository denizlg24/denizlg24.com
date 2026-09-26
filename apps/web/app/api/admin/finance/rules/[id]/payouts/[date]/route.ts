import { financePayoutOverrideInputSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { serializeFinanceRecurringRule } from "@/lib/finance/dashboard";
import { setFinancePayoutOverride } from "@/lib/finance/rules";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string; date: string }> };

async function target(context: Context) {
  const { id, date } = await context.params;
  if (!mongoose.isValidObjectId(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  return { id, date };
}

/** Sets the hand correction for one payout; null fields clear. */
export async function PUT(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const params = await target(context);
  if (!params) {
    return NextResponse.json({ error: "Invalid payout" }, { status: 400 });
  }
  const parsed = financePayoutOverrideInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid override" }, { status: 400 });
  }
  const rule = await setFinancePayoutOverride(
    params.id,
    params.date,
    parsed.data,
  );
  if (!rule) {
    return NextResponse.json({ error: "Payout not found" }, { status: 404 });
  }
  return NextResponse.json({ rule: serializeFinanceRecurringRule(rule) });
}

export async function DELETE(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const params = await target(context);
  if (!params) {
    return NextResponse.json({ error: "Invalid payout" }, { status: 400 });
  }
  const rule = await setFinancePayoutOverride(params.id, params.date, null);
  if (!rule) {
    return NextResponse.json({ error: "Payout not found" }, { status: 404 });
  }
  return NextResponse.json({ rule: serializeFinanceRecurringRule(rule) });
}
