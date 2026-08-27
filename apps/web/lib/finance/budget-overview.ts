import type {
  FinanceBudgetTotals,
  FinanceEnvelopeStatus,
  FinanceEnvelope as FinanceEnvelopeWire,
  FinanceForecast,
} from "@repo/schemas";
import { FinanceAccount, FinanceBalance } from "@/models/Finance";
import { computeFinanceForecast } from "./core";
import { selectDisplayBalances } from "./dashboard";
import {
  computeEnvelopeStatus,
  envelopeClaimsRow,
  incomeInWindow,
  isCommittedRow,
  isCountableSpendRow,
  monthlyEquivalentMinor,
  type PeriodBounds,
  unbudgetedSpend,
} from "./envelope-math";
import {
  type BudgetLedger,
  listFinanceEnvelopes,
  loadBudgetLedger,
  serializeFinanceEnvelope,
} from "./envelopes";
import type { FinanceFxConverter } from "./fx";

/**
 * Every envelope resolved against the ledger, plus the roll-up.
 *
 * Each envelope keeps its own cadence, so a weekly and a yearly envelope are
 * both reported on their own current period. The totals cannot simply add
 * those up — that would compare a week's limit against a year's — so they are
 * stated on one **calendar month**: limits become their monthly equivalent, and
 * spend, income and commitments are the calendar month's actuals. That makes
 * `plannedMinor` directly comparable to `incomeMinor`, which is the question
 * the number exists to answer.
 */

export function currentMonthBounds(asOfDate: string): PeriodBounds {
  const start = `${asOfDate.slice(0, 7)}-01`;
  const [year, month] = [
    Number(asOfDate.slice(0, 4)),
    Number(asOfDate.slice(5, 7)),
  ];
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end };
}

export function computeBudgetTotals(input: {
  currency: string;
  envelopes: FinanceEnvelopeWire[];
  statuses: FinanceEnvelopeStatus[];
  ledger: BudgetLedger["rows"];
  asOfDate: string;
}): FinanceBudgetTotals {
  const month = currentMonthBounds(input.asOfDate);
  const statusById = new Map(
    input.statuses.map((status) => [status.envelopeId, status]),
  );

  let plannedMinor = 0;
  for (const envelope of input.envelopes) {
    if (envelope.status !== "active") continue;
    if (envelope.kind === "capped") {
      plannedMinor += monthlyEquivalentMinor(
        envelope.limitMinor,
        envelope.period,
      );
      continue;
    }
    // A sinking fund's monthly claim is the contribution it needs, not the
    // whole target — the target is spread over the periods left to fund it.
    const status = statusById.get(envelope.id);
    const required = status?.requiredPerPeriodMinor ?? 0;
    plannedMinor += monthlyEquivalentMinor(required, envelope.period);
  }

  let spentMinor = 0;
  let committedMinor = 0;
  for (const row of input.ledger) {
    if (row.effectiveDate < month.start || row.effectiveDate > month.end) {
      continue;
    }
    const claimed = input.envelopes.some(
      (envelope) =>
        envelope.status === "active" && envelopeClaimsRow(envelope, row),
    );
    if (!claimed) continue;
    if (isCountableSpendRow(row)) spentMinor += -row.amountMinor;
    else if (isCommittedRow(row, input.asOfDate)) {
      committedMinor += -row.amountMinor;
    }
  }
  spentMinor = Math.max(0, spentMinor);

  const unbudgeted = unbudgetedSpend({
    envelopes: input.envelopes.filter(
      (envelope) => envelope.status === "active",
    ),
    ledger: input.ledger,
    bounds: month,
  });
  const unbudgetedMinor = unbudgeted.reduce(
    (total, row) => total + row.spentMinor,
    0,
  );

  const elapsedDays = Math.max(
    1,
    Number(input.asOfDate.slice(8, 10)) - Number(month.start.slice(8, 10)) + 1,
  );
  const monthDays = Number(month.end.slice(8, 10));
  const runRate = spentMinor / elapsedDays;
  const projectedMinor = Math.round(
    spentMinor +
      committedMinor +
      runRate * Math.max(0, monthDays - elapsedDays),
  );

  return {
    currency: input.currency,
    plannedMinor,
    spentMinor,
    committedMinor,
    availableMinor: plannedMinor - spentMinor - committedMinor,
    projectedMinor,
    unbudgetedMinor,
    incomeMinor: incomeInWindow(input.ledger, month),
  };
}

export interface BudgetSnapshot {
  asOfDate: string;
  currency: string;
  envelopes: FinanceEnvelopeWire[];
  statuses: FinanceEnvelopeStatus[];
  unbudgeted: ReturnType<typeof unbudgetedSpend>;
  totals: FinanceBudgetTotals;
  ledger: BudgetLedger;
  /** Aggregate of the preferred balance per account, in the base currency.
   *  Undefined when no rate could convert one of them, which must not be read
   *  as zero. */
  balanceMinor?: number;
  forecast?: FinanceForecast;
}

/**
 * Aggregate spendable balance in the base currency, reusing the loaded FX
 * converter rather than re-reading snapshots. Returns undefined if any account
 * could not be converted — a partial aggregate would read as a real drop.
 */
async function aggregateBalanceMinor(
  baseCurrency: string,
  converter: FinanceFxConverter,
) {
  const [accounts, balances] = await Promise.all([
    FinanceAccount.find().select({ _id: 1 }),
    FinanceBalance.find().sort({ fetchedAt: -1 }),
  ]);
  const selected = selectDisplayBalances(
    balances,
    accounts.map((account) => account._id.toString()),
  );
  let total = 0;
  for (const balance of selected) {
    const converted = converter.convert(
      balance.amountMinor,
      balance.currency,
      baseCurrency,
    );
    if (converted === undefined) return undefined;
    total += converted;
  }
  return total;
}

/**
 * Restates an envelope in the base currency.
 *
 * New envelopes are written in the base currency, so this only bites when the
 * base itself has been changed in settings and older rows still carry the
 * previous one. Spend is measured from base-converted ledger rows, so a limit
 * left in the old currency would be compared against a different unit. An
 * envelope no rate can reach is dropped rather than shown against a limit that
 * does not mean what it says.
 */
function rebaseEnvelope(
  envelope: FinanceEnvelopeWire,
  ledger: BudgetLedger,
): FinanceEnvelopeWire[] {
  if (envelope.currency === ledger.currency) return [envelope];
  const convert = (amountMinor: number) =>
    ledger.converter.convert(amountMinor, envelope.currency, ledger.currency);
  const limitMinor = convert(envelope.limitMinor);
  if (limitMinor === undefined) {
    console.warn("[finance] Envelope has no rate to the base currency", {
      envelopeId: envelope.id,
      from: envelope.currency,
      to: ledger.currency,
    });
    return [];
  }
  const contributions = envelope.contributions.flatMap((contribution) => {
    const amountMinor = convert(contribution.amountMinor);
    return amountMinor === undefined ? [] : [{ ...contribution, amountMinor }];
  });
  return [
    { ...envelope, currency: ledger.currency, limitMinor, contributions },
  ];
}

/**
 * The computed half of the budget, with no alerts or suggestions attached.
 * The alert evaluator reads this, so it must not itself read alerts.
 */
export async function getBudgetSnapshot(
  now = new Date(),
): Promise<BudgetSnapshot> {
  const asOfDate = now.toISOString().slice(0, 10);
  const [envelopeDocs, ledger] = await Promise.all([
    listFinanceEnvelopes(),
    loadBudgetLedger(now),
  ]);
  const envelopes = envelopeDocs
    .map(serializeFinanceEnvelope)
    .flatMap((envelope) => rebaseEnvelope(envelope, ledger));
  const statuses = envelopes.map((envelope) =>
    computeEnvelopeStatus({ envelope, ledger: ledger.rows, asOfDate }),
  );
  const balanceMinor = await aggregateBalanceMinor(
    ledger.currency,
    ledger.converter,
  );
  return {
    balanceMinor,
    forecast:
      balanceMinor === undefined
        ? undefined
        : computeFinanceForecast({
            currency: ledger.currency,
            currentBalanceMinor: balanceMinor,
            ledger: ledger.rows,
            asOfDate,
          }),
    asOfDate,
    currency: ledger.currency,
    envelopes,
    statuses,
    unbudgeted: unbudgetedSpend({
      envelopes,
      ledger: ledger.rows,
      bounds: currentMonthBounds(asOfDate),
    }),
    totals: computeBudgetTotals({
      currency: ledger.currency,
      envelopes,
      statuses,
      ledger: ledger.rows,
      asOfDate,
    }),
    ledger,
  };
}
