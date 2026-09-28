import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import {
  serializeFinanceDeductionProfile,
  serializeFinanceRecurringRule,
} from "@/lib/finance/dashboard";
import { listPayoutSchedule } from "@/lib/finance/payouts";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import {
  FinanceDeductionProfile,
  FinanceRecurringRule,
} from "@/models/Finance";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid rule" }, { status: 400 });
  }
  await connectDB();
  const rule = await FinanceRecurringRule.findById(id);
  if (!rule?.payout) {
    return NextResponse.json({ error: "Payout not found" }, { status: 404 });
  }
  const profileId = rule.payout.deductionProfileId;
  const [periods, profile] = await Promise.all([
    listPayoutSchedule(rule),
    profileId && mongoose.isValidObjectId(profileId)
      ? FinanceDeductionProfile.findById(profileId)
      : null,
  ]);
  return NextResponse.json({
    rule: serializeFinanceRecurringRule(rule),
    profile: profile ? serializeFinanceDeductionProfile(profile) : null,
    periods,
  });
}
