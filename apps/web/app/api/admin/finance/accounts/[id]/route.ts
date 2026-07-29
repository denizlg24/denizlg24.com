import { financeAccountSettingsInputSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { FinanceAccount } from "@/models/Finance";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid account" }, { status: 400 });
  }
  const parsed = financeAccountSettingsInputSchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid account settings" },
      { status: 400 },
    );
  }
  await connectDB();
  const current = await FinanceAccount.findById(id);
  if (!current) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  const dailyFetchLimit =
    parsed.data.dailyFetchLimit ?? current.dailyFetchLimit;
  const reservedManualFetches =
    parsed.data.reservedManualFetches ?? current.reservedManualFetches;
  if (reservedManualFetches >= dailyFetchLimit) {
    return NextResponse.json(
      { error: "Manual reserve must be below the daily limit" },
      { status: 400 },
    );
  }
  current.set(parsed.data);
  await current.save();
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid account" }, { status: 400 });
  }
  await connectDB();
  const account = await FinanceAccount.findByIdAndUpdate(
    id,
    {
      $set: { connectionStatus: "disconnected" },
      $unset: { encryptedProviderSessionRef: "" },
    },
    { returnDocument: "after" },
  );
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
