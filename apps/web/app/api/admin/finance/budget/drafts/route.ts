import { financeEnvelopePeriodSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { draftFinanceEnvelopes } from "@/lib/finance/envelopes";
import { requireAdmin } from "@/lib/require-admin";

/** A starter plan from spending history, with no model involved. */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const params = request.nextUrl.searchParams;
  const period = financeEnvelopePeriodSchema.safeParse(params.get("period"));
  const periods = Number(params.get("periods"));
  const headroom = Number(params.get("headroomPercent"));
  const drafts = await draftFinanceEnvelopes({
    period: period.success ? period.data : undefined,
    periods: Number.isFinite(periods) ? periods : undefined,
    headroomPercent: Number.isFinite(headroom) ? headroom : undefined,
  });
  return NextResponse.json({ drafts });
}
