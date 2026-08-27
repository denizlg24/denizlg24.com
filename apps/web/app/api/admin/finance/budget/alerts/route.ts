import type {
  FinanceBudgetAlertKind,
  FinanceBudgetAlertSeverity,
} from "@repo/schemas";
import {
  financeBudgetAlertKindSchema,
  financeBudgetAlertSeveritySchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  evaluateFinanceBudgetAlerts,
  listFinanceBudgetAlerts,
} from "@/lib/finance/budget-alerts";
import { requireAdmin } from "@/lib/require-admin";

const STATUSES = ["open", "acknowledged", "resolved"] as const;

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const params = request.nextUrl.searchParams;
  const status = params
    .getAll("status")
    .filter((value): value is (typeof STATUSES)[number] =>
      STATUSES.includes(value as (typeof STATUSES)[number]),
    );
  const severity = params
    .getAll("severity")
    .filter(
      (value): value is FinanceBudgetAlertSeverity =>
        financeBudgetAlertSeveritySchema.safeParse(value).success,
    );
  const kind = params
    .getAll("kind")
    .filter(
      (value): value is FinanceBudgetAlertKind =>
        financeBudgetAlertKindSchema.safeParse(value).success,
    );
  const alerts = await listFinanceBudgetAlerts({
    status: status.length ? status : undefined,
    severity: severity.length ? severity : undefined,
    kind: kind.length ? kind : undefined,
  });
  return NextResponse.json({ alerts });
}

/** Re-derives the alert set now instead of waiting for the finance cron. */
export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    return NextResponse.json(await evaluateFinanceBudgetAlerts());
  } catch (error) {
    console.error("[finance] Budget alert evaluation failed", error);
    return NextResponse.json(
      { error: "Failed to evaluate alerts" },
      { status: 500 },
    );
  }
}
