import mongoose from "mongoose";
import { after, type NextRequest, NextResponse } from "next/server";
import { attendedFinanceHeaders, syncFinanceAccount } from "@/lib/finance/sync";
import { requireAdmin } from "@/lib/require-admin";

// Balance and transaction calls reach the bank live; this matches the finance
// cron route, which runs the same work.
export const maxDuration = 300;

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
        defer: after,
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
