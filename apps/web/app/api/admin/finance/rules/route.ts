import { financeRecurringRuleInputSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { after, type NextRequest, NextResponse } from "next/server";
import { serializeFinanceRecurringRule } from "@/lib/finance/dashboard";
import { materializeRecurringFinanceEntries } from "@/lib/finance/ledger";
import { observeFinanceMemorySafely } from "@/lib/finance/memory";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import {
  FinanceRecurringRule,
  type IFinanceRecurringRule,
} from "@/models/Finance";

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
  await connectDB();
  const session = await mongoose.startSession();
  let rule: IFinanceRecurringRule | undefined;
  try {
    await session.withTransaction(async () => {
      const [created] = await FinanceRecurringRule.create([parsed.data], {
        session,
      });
      rule = created;
      await materializeRecurringFinanceEntries(new Date(), {
        session,
        skipSuggestions: true,
      });
    });
  } catch (error) {
    console.error("[finance] Rule creation failed", error);
    return NextResponse.json(
      { error: "Failed to create recurring rule" },
      { status: 500 },
    );
  } finally {
    await session.endSession();
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
