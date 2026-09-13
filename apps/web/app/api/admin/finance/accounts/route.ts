import { type NextRequest, NextResponse } from "next/server";
import { listFinanceAccounts } from "@/lib/finance/accounts";
import { serializeFinanceAccount } from "@/lib/finance/dashboard";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const accounts = await listFinanceAccounts();
    return NextResponse.json({
      accounts: accounts.map(serializeFinanceAccount),
    });
  } catch (error) {
    console.error("[finance] Account list failed", error);
    return NextResponse.json(
      { error: "Failed to list accounts" },
      { status: 500 },
    );
  }
}
