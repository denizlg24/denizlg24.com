import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { attendedFinanceHeaders, syncFinanceAccount } from "@/lib/finance/sync";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid account" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await syncFinanceAccount(id, {
        mode: "manual",
        ...attendedFinanceHeaders(request),
      }),
    );
  } catch (error) {
    console.error("[finance] Manual sync failed", error);
    return NextResponse.json(
      { error: "Failed to sync account" },
      { status: 500 },
    );
  }
}
