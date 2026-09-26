import { financeDeductionProfileInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { serializeFinanceDeductionProfile } from "@/lib/finance/dashboard";
import {
  createFinanceDeductionProfile,
  listFinanceDeductionProfiles,
} from "@/lib/finance/deductions";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const profiles = await listFinanceDeductionProfiles();
    return NextResponse.json({
      profiles: profiles.map(serializeFinanceDeductionProfile),
    });
  } catch (error) {
    console.error("[finance] Deduction profile list failed", error);
    return NextResponse.json(
      { error: "Failed to list deduction profiles" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = financeDeductionProfileInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid deduction profile" },
      { status: 400 },
    );
  }
  try {
    const profile = await createFinanceDeductionProfile(parsed.data);
    return NextResponse.json(
      { profile: serializeFinanceDeductionProfile(profile) },
      { status: 201 },
    );
  } catch (error) {
    console.error("[finance] Deduction profile creation failed", error);
    return NextResponse.json(
      { error: "Failed to create deduction profile" },
      { status: 500 },
    );
  }
}
