import { financeSpendSummaryQuerySchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { summarizeFinanceByCategory } from "@/lib/finance/queries";
import { requireAdmin } from "@/lib/require-admin";

/** Spend and income per category and currency; nothing here is converted. */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const search = request.nextUrl.searchParams;
  const parsed = financeSpendSummaryQuerySchema.safeParse({
    from: search.get("from") ?? undefined,
    to: search.get("to") ?? undefined,
    accountId: search.get("accountId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "from and to are required ISO dates" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json({
      categories: await summarizeFinanceByCategory(parsed.data),
    });
  } catch (error) {
    console.error("[finance] Spend summary failed", error);
    return NextResponse.json(
      { error: "Failed to summarize spend" },
      { status: 500 },
    );
  }
}
