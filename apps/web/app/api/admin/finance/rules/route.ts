import { financeRecurringRuleInputSchema } from "@repo/schemas";
import { after, type NextRequest, NextResponse } from "next/server";
import { serializeFinanceRecurringRule } from "@/lib/finance/dashboard";
import { observeFinanceMemorySafely } from "@/lib/finance/memory";
import { createFinanceRecurringRule } from "@/lib/finance/rules";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = financeRecurringRuleInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid recurring rule" },
      { status: 400 },
    );
  }
  let rule: Awaited<ReturnType<typeof createFinanceRecurringRule>>;
  try {
    rule = await createFinanceRecurringRule(parsed.data);
  } catch (error) {
    console.error("[finance] Rule creation failed", error);
    return NextResponse.json(
      { error: "Failed to create recurring rule" },
      { status: 500 },
    );
  }
  if (!rule) {
    return NextResponse.json(
      { error: "Failed to create recurring rule" },
      { status: 500 },
    );
  }
  after(() => observeFinanceMemorySafely());
  return NextResponse.json(
    { rule: serializeFinanceRecurringRule(rule) },
    { status: 201 },
  );
}
