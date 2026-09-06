import type { FinanceEnvelopeDetail } from "@repo/schemas";
import { listFinanceBudgetAlerts } from "./budget-alerts";
import {
  computeEnvelopeStatus,
  envelopeClaimsRow,
  isCommittedRow,
  isCountableSpendRow,
  periodBounds,
  rolloverWalkBack,
} from "./envelope-math";
import {
  getFinanceEnvelope,
  loadBudgetLedger,
  serializeFinanceEnvelope,
} from "./envelopes";

/**
 * One envelope with the evidence behind its numbers.
 *
 * The budget overview reports every envelope's status and nothing about how it
 * got there, which is exactly the view that cannot answer "is this limit
 * right". This adds the three things that can: the rows charged to it this
 * period, the walk-back that produced the carried balance, and the alerts that
 * name it.
 */
export async function getFinanceEnvelopeDetail(
  id: string,
  now = new Date(),
): Promise<FinanceEnvelopeDetail | null> {
  const doc = await getFinanceEnvelope(id);
  if (!doc) return null;

  const asOfDate = now.toISOString().slice(0, 10);
  const ledger = await loadBudgetLedger(now);
  const envelope = serializeFinanceEnvelope(doc);

  const status = computeEnvelopeStatus({
    envelope,
    ledger: ledger.rows,
    asOfDate,
  });
  const bounds = periodBounds({
    period: envelope.period,
    date: asOfDate,
    startDay: envelope.periodStartDay,
    anchorDate: envelope.startDate,
  });

  // Both the rows that have already been charged and the ones committed for
  // later in the period: `availableMinor` subtracts both, so showing only the
  // spend would leave the figure unexplained.
  const entries = ledger.rows
    .filter(
      (row) =>
        row.effectiveDate >= bounds.start &&
        row.effectiveDate <= bounds.end &&
        envelopeClaimsRow(envelope, row) &&
        (isCountableSpendRow(row) || isCommittedRow(row, asOfDate)),
    )
    .sort((left, right) =>
      right.effectiveDate.localeCompare(left.effectiveDate),
    );

  const alerts = (
    await listFinanceBudgetAlerts({
      status: ["open", "acknowledged", "resolved"],
    })
  ).filter((alert) => alert.envelopeId === envelope.id);

  return {
    envelope,
    status,
    currency: ledger.currency,
    asOfDate,
    entries,
    rollover: rolloverWalkBack({ envelope, ledger: ledger.rows, bounds }),
    alerts,
  };
}
