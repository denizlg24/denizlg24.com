import { financeRecurringRuleInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { serializeFinanceRecurringRule } from "@/lib/finance/dashboard";
import { materializeRecurringFinanceEntries } from "@/lib/finance/ledger";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { FinanceRecurringRule } from "@/models/Finance";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = financeRecurringRuleInputSchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid recurring rule" },
      { status: 400 },
    );
  }
  await connectDB();
  const rule = await FinanceRecurringRule.create(parsed.data);
  await materializeRecurringFinanceEntries();
  return NextResponse.json(
    { rule: serializeFinanceRecurringRule(rule) },
    { status: 201 },
  );
}
