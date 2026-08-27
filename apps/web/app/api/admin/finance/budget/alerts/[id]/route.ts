import { financeBudgetAlertDecisionSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { decideFinanceBudgetAlert } from "@/lib/finance/budget-alerts";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  const parsed = financeBudgetAlertDecisionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }
  const alert = await decideFinanceBudgetAlert(id, parsed.data.action);
  if (!alert) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }
  return NextResponse.json({ alert });
}
