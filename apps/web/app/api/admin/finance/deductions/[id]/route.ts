import { financeDeductionProfileInputSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { serializeFinanceDeductionProfile } from "@/lib/finance/dashboard";
import {
  deleteFinanceDeductionProfile,
  FinanceDeductionProfileInUseError,
  updateFinanceDeductionProfile,
} from "@/lib/finance/deductions";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string }> };
const updateSchema = financeDeductionProfileInputSchema.partial();

export async function PATCH(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid profile" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid deduction profile" },
      { status: 400 },
    );
  }
  const profile = await updateFinanceDeductionProfile(id, parsed.data);
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }
  return NextResponse.json({
    profile: serializeFinanceDeductionProfile(profile),
  });
}

export async function DELETE(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid profile" }, { status: 400 });
  }
  try {
    const profile = await deleteFinanceDeductionProfile(id);
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof FinanceDeductionProfileInUseError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
