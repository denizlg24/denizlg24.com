import { financeBudgetSuggestionDecisionSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  decideFinanceBudgetSuggestion,
  FinanceSuggestionApplyError,
} from "@/lib/finance/budget-coach";
import { FinanceEnvelopeConflictError } from "@/lib/finance/envelopes";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  const parsed = financeBudgetSuggestionDecisionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }
  try {
    const suggestion = await decideFinanceBudgetSuggestion(
      id,
      parsed.data.action,
    );
    if (!suggestion) {
      return NextResponse.json(
        { error: "Suggestion not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ suggestion });
  } catch (error) {
    // 422, not 400: the request was well formed and the suggestion was
    // refused on the state of the budget, which is the caller's cue to reload
    // rather than to fix their payload.
    if (
      error instanceof FinanceSuggestionApplyError ||
      error instanceof FinanceEnvelopeConflictError
    ) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error("[finance] Suggestion decision failed", error);
    return NextResponse.json(
      { error: "Failed to resolve suggestion" },
      { status: 500 },
    );
  }
}
