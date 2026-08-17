import { financeRecurringRuleInputSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { after, type NextRequest, NextResponse } from "next/server";
import { serializeFinanceRecurringRule } from "@/lib/finance/dashboard";
import { observeFinanceMemorySafely } from "@/lib/finance/memory";
import {
  deleteFinanceRecurringRule,
  updateFinanceRecurringRule,
} from "@/lib/finance/rules";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string }> };
const updateSchema = financeRecurringRuleInputSchema.partial();

export async function PATCH(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid rule" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid recurring rule" },
      { status: 400 },
    );
  }
  const rule = await updateFinanceRecurringRule(id, parsed.data);
  if (!rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
  after(() => observeFinanceMemorySafely());
  return NextResponse.json({ rule: serializeFinanceRecurringRule(rule) });
}

export async function DELETE(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid rule" }, { status: 400 });
  }
  const rule = await deleteFinanceRecurringRule(id);
  if (!rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
  after(() => observeFinanceMemorySafely());
  return NextResponse.json({ success: true });
}
