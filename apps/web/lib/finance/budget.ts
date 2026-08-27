import type { FinanceBudgetOverview } from "@repo/schemas";
import { listFinanceBudgetAlerts } from "./budget-alerts";
import { listFinanceBudgetSuggestions } from "./budget-coach";
import { getBudgetSnapshot } from "./budget-overview";

/**
 * The whole budgeting payload for one request.
 *
 * Kept apart from `budget-overview` so that module stays free of alerts and
 * suggestions: the alert evaluator reads the snapshot, so a snapshot that read
 * alerts back would be a cycle.
 */
export async function getFinanceBudgetOverview(
  now = new Date(),
): Promise<FinanceBudgetOverview> {
  const snapshot = await getBudgetSnapshot(now);
  const [alerts, suggestions] = await Promise.all([
    listFinanceBudgetAlerts({ status: ["open", "acknowledged"] }),
    listFinanceBudgetSuggestions({ status: ["open"] }),
  ]);
  return {
    asOfDate: snapshot.asOfDate,
    currency: snapshot.currency,
    envelopes: snapshot.envelopes,
    statuses: snapshot.statuses,
    unbudgeted: snapshot.unbudgeted,
    totals: snapshot.totals,
    alerts,
    suggestions,
    unconvertedByCurrency: snapshot.ledger.unconvertedByCurrency,
  };
}
