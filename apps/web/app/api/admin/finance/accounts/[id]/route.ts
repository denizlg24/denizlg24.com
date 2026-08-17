import { financeAccountSettingsInputSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import {
  disconnectFinanceAccount,
  FinanceBudgetReserveError,
  updateFinanceAccountSettings,
} from "@/lib/finance/accounts";
import { serializeFinanceAccount } from "@/lib/finance/dashboard";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid account" }, { status: 400 });
  }
  const parsed = financeAccountSettingsInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid account settings" },
      { status: 400 },
    );
  }
  try {
    const account = await updateFinanceAccountSettings(id, parsed.data);
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      account: serializeFinanceAccount(account),
    });
  } catch (error) {
    if (error instanceof FinanceBudgetReserveError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid account" }, { status: 400 });
  }
  const account = await disconnectFinanceAccount(id);
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
