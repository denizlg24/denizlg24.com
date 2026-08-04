import { z } from "zod";
import type { Fact, FiscalPeriod, Statement } from "../../schemas";

/**
 * The subset of us-gaap worth keeping. `companyfacts` runs to several megabytes
 * of every concept a filer has ever tagged; distilling on the server keeps the
 * cache small and the wire payload sane.
 *
 * Each entry lists concepts most-preferred first. Filers tag the same economic
 * line differently — post-ASC-606 revenue is
 * RevenueFromContractWithCustomerExcludingAssessedTax, older filings use
 * Revenues or SalesRevenueNet — so the first concept present wins.
 */
export interface FactDefinition {
  key: string;
  label: string;
  statement: Statement;
  concepts: string[];
}

export const FACT_DEFINITIONS: FactDefinition[] = [
  {
    key: "revenue",
    label: "Revenue",
    statement: "income",
    concepts: [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "Revenues",
      "SalesRevenueNet",
    ],
  },
  {
    key: "costOfRevenue",
    label: "Cost of revenue",
    statement: "income",
    concepts: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfServices"],
  },
  {
    key: "grossProfit",
    label: "Gross profit",
    statement: "income",
    concepts: ["GrossProfit"],
  },
  {
    key: "researchAndDevelopment",
    label: "R&D",
    statement: "income",
    concepts: ["ResearchAndDevelopmentExpense"],
  },
  {
    key: "sellingGeneralAdministrative",
    label: "SG&A",
    statement: "income",
    concepts: [
      "SellingGeneralAndAdministrativeExpense",
      "GeneralAndAdministrativeExpense",
    ],
  },
  {
    key: "operatingExpenses",
    label: "Operating expenses",
    statement: "income",
    concepts: ["OperatingExpenses", "CostsAndExpenses"],
  },
  {
    key: "operatingIncome",
    label: "Operating income",
    statement: "income",
    concepts: ["OperatingIncomeLoss"],
  },
  {
    key: "interestExpense",
    label: "Interest expense",
    statement: "income",
    concepts: ["InterestExpense", "InterestExpenseNonoperating"],
  },
  {
    key: "incomeBeforeTax",
    label: "Pre-tax income",
    statement: "income",
    concepts: [
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    ],
  },
  {
    key: "incomeTaxExpense",
    label: "Income tax",
    statement: "income",
    concepts: ["IncomeTaxExpenseBenefit"],
  },
  {
    key: "netIncome",
    label: "Net income",
    statement: "income",
    concepts: ["NetIncomeLoss", "ProfitLoss"],
  },
  {
    key: "epsBasic",
    label: "EPS basic",
    statement: "income",
    concepts: ["EarningsPerShareBasic"],
  },
  {
    key: "epsDiluted",
    label: "EPS diluted",
    statement: "income",
    concepts: ["EarningsPerShareDiluted"],
  },
  {
    key: "sharesDiluted",
    label: "Diluted shares",
    statement: "income",
    concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
  },
  {
    key: "cashAndEquivalents",
    label: "Cash & equivalents",
    statement: "balance",
    concepts: [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
  },
  {
    key: "shortTermInvestments",
    label: "Short-term investments",
    statement: "balance",
    concepts: ["ShortTermInvestments", "MarketableSecuritiesCurrent"],
  },
  {
    key: "receivables",
    label: "Receivables",
    statement: "balance",
    concepts: ["AccountsReceivableNetCurrent"],
  },
  {
    key: "inventory",
    label: "Inventory",
    statement: "balance",
    concepts: ["InventoryNet"],
  },
  {
    key: "totalCurrentAssets",
    label: "Current assets",
    statement: "balance",
    concepts: ["AssetsCurrent"],
  },
  {
    key: "propertyPlantEquipment",
    label: "PP&E",
    statement: "balance",
    concepts: ["PropertyPlantAndEquipmentNet"],
  },
  {
    key: "goodwill",
    label: "Goodwill",
    statement: "balance",
    concepts: ["Goodwill"],
  },
  {
    key: "totalAssets",
    label: "Total assets",
    statement: "balance",
    concepts: ["Assets"],
  },
  {
    key: "accountsPayable",
    label: "Accounts payable",
    statement: "balance",
    concepts: ["AccountsPayableCurrent"],
  },
  {
    key: "totalCurrentLiabilities",
    label: "Current liabilities",
    statement: "balance",
    concepts: ["LiabilitiesCurrent"],
  },
  {
    key: "longTermDebt",
    label: "Long-term debt",
    statement: "balance",
    concepts: ["LongTermDebtNoncurrent", "LongTermDebt"],
  },
  {
    key: "totalLiabilities",
    label: "Total liabilities",
    statement: "balance",
    concepts: ["Liabilities"],
  },
  {
    key: "retainedEarnings",
    label: "Retained earnings",
    statement: "balance",
    concepts: ["RetainedEarningsAccumulatedDeficit"],
  },
  {
    key: "totalEquity",
    label: "Shareholders' equity",
    statement: "balance",
    concepts: [
      "StockholdersEquity",
      "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ],
  },
  {
    key: "sharesOutstanding",
    label: "Shares outstanding",
    statement: "balance",
    concepts: ["CommonStockSharesOutstanding", "CommonStockSharesIssued"],
  },
  {
    key: "operatingCashFlow",
    label: "Operating cash flow",
    statement: "cashflow",
    concepts: [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
  },
  {
    key: "capitalExpenditures",
    label: "Capex",
    statement: "cashflow",
    concepts: [
      "PaymentsToAcquirePropertyPlantAndEquipment",
      "PaymentsToAcquireProductiveAssets",
    ],
  },
  {
    key: "investingCashFlow",
    label: "Investing cash flow",
    statement: "cashflow",
    concepts: ["NetCashProvidedByUsedInInvestingActivities"],
  },
  {
    key: "financingCashFlow",
    label: "Financing cash flow",
    statement: "cashflow",
    concepts: ["NetCashProvidedByUsedInFinancingActivities"],
  },
  {
    key: "dividendsPaid",
    label: "Dividends paid",
    statement: "cashflow",
    concepts: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
  },
  {
    key: "stockRepurchased",
    label: "Buybacks",
    statement: "cashflow",
    concepts: ["PaymentsForRepurchaseOfCommonStock"],
  },
  {
    key: "depreciationAmortization",
    label: "D&A",
    statement: "cashflow",
    concepts: [
      "DepreciationDepletionAndAmortization",
      "DepreciationAmortizationAndAccretionNet",
      "Depreciation",
    ],
  },
];

/**
 * The shape `companyfacts` is actually read for. Validated structurally rather
 * than cast, because `distillCompanyFacts` iterates `units` entries and an
 * unexpected SEC payload would otherwise throw somewhere in the middle of the
 * walk instead of surfacing as a `ProviderError`.
 *
 * Unknown concepts and unknown keys are tolerated by design: this is a foreign
 * payload that grows, and only the tracked facts are ever read.
 */
export const companyFactUnitSchema = z.object({
  start: z.string().optional(),
  end: z.string(),
  val: z.number(),
  accn: z.string(),
  /**
   * Explicitly null on entries SEC lifted out of a restatement filing — an 8-K
   * reissuing prior years carries the value with no fiscal context at all.
   * Rejecting those used to cost the concept every entry it had; see
   * `factEntriesSchema`.
   */
  fy: z.number().nullish(),
  fp: z.string().nullish(),
  form: z.string(),
  filed: z.string(),
  frame: z.string().optional(),
});
export type CompanyFactUnit = z.infer<typeof companyFactUnitSchema>;

/**
 * Validates one entry at a time and keeps the ones that fit.
 *
 * `z.array(companyFactUnitSchema).catch([])` reads like the same tolerance and
 * is not: a single malformed entry replaces the entire array, so a concept is
 * all-or-nothing. SEC ships a handful of context-free restatement rows per
 * concept, which made that total — AAPL's `NetIncomeLoss` lost all 338 entries
 * to the 11 that carried `fy: null`, and with them P/E, EPS, margins and ROE.
 */
const factEntriesSchema = z
  .array(z.unknown())
  .transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = companyFactUnitSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    }),
  )
  .catch([]);

export const companyFactsPayloadSchema = z.object({
  cik: z.number(),
  entityName: z.string().optional(),
  facts: z
    .object({
      "us-gaap": z
        .record(
          z.string(),
          z.object({
            // Null for deprecated and unlabelled concepts; never read, since
            // every emitted fact takes its label from FACT_DEFINITIONS.
            label: z.string().nullish(),
            units: z.record(z.string(), factEntriesSchema).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});
export type CompanyFactsPayload = z.infer<typeof companyFactsPayloadSchema>;

export interface DistilledPeriod {
  fiscalYear: number;
  fiscalPeriod: FiscalPeriod;
  periodStart?: string;
  periodEnd: string;
  form: string;
  filed: string;
  accession: string;
  facts: Fact[];
}

function isFiscalPeriod(
  value: string | null | undefined,
): value is FiscalPeriod {
  return (
    value === "FY" ||
    value === "Q1" ||
    value === "Q2" ||
    value === "Q3" ||
    value === "Q4"
  );
}

/** A duration covering a fiscal year, a single quarter, or neither. */
type DurationType = "FY" | "Q";

/**
 * Which window a duration covers, read from the duration itself rather than
 * from the filing's `fp`.
 *
 * `fp` cannot do this job: a Q3 10-Q tags income and cash-flow concepts twice,
 * once for the three-month quarter and once for the nine-month year to date,
 * and both carry `fy: 2026`, `fp: "Q3"` and the same `end`. Year-to-date spans
 * match neither band and are dropped, so a nine-month figure can never be
 * summed as though it were one quarter.
 */
function durationType(start: string, end: string): DurationType | null {
  const days =
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
    86_400_000;
  if (!Number.isFinite(days)) return null;
  if (days >= 80 && days <= 100) return "Q";
  if (days >= 330 && days <= 400) return "FY";
  return null;
}

interface Contribution {
  definition: FactDefinition;
  concept: string;
  /** Index into the definition's concept list; lower is more preferred. */
  rank: number;
  unit: string;
  value: number;
  start?: string;
  end: string;
  type: DurationType | "instant";
  form: string;
  filed: string;
  accession: string;
  fy?: number | null;
  fp?: string | null;
}

interface PeriodAccumulator {
  type: DurationType | "instant";
  periodStart?: string;
  periodEnd: string;
  facts: Map<string, { fact: Fact; filed: string; rank: number }>;
  /** Oldest filing wins, so the label comes from the report that owned it. */
  origin: Contribution | null;
}

/** Calendar-quarter fallback for a filer whose own `fp` is missing or junk. */
function derivedFiscalPeriod(type: DurationType | "instant", end: string) {
  if (type === "FY") return "FY" as const;
  const month = Number(end.slice(5, 7));
  return ([
    "Q1",
    "Q1",
    "Q1",
    "Q2",
    "Q2",
    "Q2",
    "Q3",
    "Q3",
    "Q3",
    "Q4",
    "Q4",
    "Q4",
  ][Math.max(0, Math.min(11, month - 1))] ?? "Q4") as FiscalPeriod;
}

function upsertPeriod(
  periods: Map<string, PeriodAccumulator>,
  key: string,
  contribution: Contribution,
): void {
  let period = periods.get(key);
  if (!period) {
    period = {
      type: contribution.type,
      periodStart: contribution.start,
      periodEnd: contribution.end,
      facts: new Map(),
      origin: null,
    };
    periods.set(key, period);
  }

  // Preferred concept first, and only then newest filing. A later filing must
  // not let a fallback concept displace the preferred one for the same period,
  // or a single line would flip between concepts from quarter to quarter.
  const existing = period.facts.get(contribution.definition.key);
  const better =
    !existing ||
    contribution.rank < existing.rank ||
    (contribution.rank === existing.rank &&
      contribution.filed > existing.filed);
  if (better) {
    period.facts.set(contribution.definition.key, {
      filed: contribution.filed,
      rank: contribution.rank,
      fact: {
        key: contribution.definition.key,
        label: contribution.definition.label,
        statement: contribution.definition.statement,
        value: contribution.value,
        unit: contribution.unit,
        concept: contribution.concept,
      },
    });
  }

  // The label tracks the earliest filing rather than the latest value, because
  // a period appears in later filings only as a comparative and those carry the
  // *filing's* fiscal context, not the period's. Taking the newest is how one
  // balance-sheet date ended up labelled Q1, Q2 and Q3 of the following year.
  if (!period.origin || contribution.filed < period.origin.filed) {
    period.origin = contribution;
  }
}

/**
 * Collapses a companyfacts payload into one row per reported period.
 *
 * Periods are keyed on the window actually measured — a duration by its span,
 * a balance-sheet instant by its date — never on the filing's `fy`/`fp`. Those
 * describe the report a value was printed in, so keying on them splits one
 * period into a row per filing that ever restated or compared against it.
 *
 * Instant facts attach to every duration ending on their date, so a quarter
 * carries both its income statement and the balance sheet drawn on its last
 * day. Only the first concept present for a key is taken, so a filer tagging
 * both `Revenues` and the ASC-606 concept does not produce two revenue lines.
 */
export function distillCompanyFacts(
  payload: CompanyFactsPayload,
  options?: { forms?: string[] },
): DistilledPeriod[] {
  const gaap = payload.facts?.["us-gaap"];
  if (!gaap) return [];
  const allowedForms = options?.forms ?? ["10-K", "10-Q", "20-F", "40-F"];

  const durations: Contribution[] = [];
  const instants: Contribution[] = [];

  for (const definition of FACT_DEFINITIONS) {
    // Every concept is read, not just the first one the filer happens to tag,
    // and preference is applied per period. NVDA tags 28 entries of the ASC-606
    // revenue concept and 276 of `Revenues`; picking the preferred concept
    // company-wide left recent quarters with no revenue at all, which showed up
    // as a P/S of 402 and a gross margin over 1700%.
    definition.concepts.forEach((concept, rank) => {
      const units = gaap[concept]?.units;
      if (!units) return;

      for (const [unit, entries] of Object.entries(units)) {
        for (const entry of entries) {
          if (!allowedForms.includes(entry.form)) continue;
          const type = entry.start
            ? durationType(entry.start, entry.end)
            : ("instant" as const);
          if (type === null) continue;

          const contribution: Contribution = {
            definition,
            concept,
            rank,
            unit,
            value: entry.val,
            start: entry.start,
            end: entry.end,
            type,
            form: entry.form,
            filed: entry.filed,
            accession: entry.accn,
            fy: entry.fy,
            fp: entry.fp,
          };
          if (type === "instant") instants.push(contribution);
          else durations.push(contribution);
        }
      }
    });
  }

  const periods = new Map<string, PeriodAccumulator>();
  for (const contribution of durations) {
    upsertPeriod(
      periods,
      `${contribution.type}:${contribution.end}`,
      contribution,
    );
  }

  // A balance sheet belongs to whichever reporting windows close on its date.
  // Where none does it stands alone, so the newest equity and liability figures
  // stay reachable even before the matching income statement is tagged.
  const durationEnds = new Set(
    durations.map((contribution) => contribution.end),
  );
  for (const contribution of instants) {
    if (!durationEnds.has(contribution.end)) {
      upsertPeriod(periods, `instant:${contribution.end}`, contribution);
      continue;
    }
    for (const type of ["FY", "Q"] as const) {
      if (periods.has(`${type}:${contribution.end}`)) {
        upsertPeriod(periods, `${type}:${contribution.end}`, contribution);
      }
    }
  }

  return [...periods.values()]
    .filter((period) => period.facts.size > 0)
    .map((period) => {
      const origin = period.origin;
      const fiscalPeriod =
        origin && isFiscalPeriod(origin.fp)
          ? origin.fp
          : derivedFiscalPeriod(period.type, period.periodEnd);
      return {
        fiscalYear: origin?.fy ?? Number(period.periodEnd.slice(0, 4)),
        fiscalPeriod,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        form: origin?.form ?? "",
        filed: origin?.filed ?? period.periodEnd,
        accession: origin?.accession ?? "",
        facts: [...period.facts.values()].map((entry) => entry.fact),
      } satisfies DistilledPeriod;
    })
    .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1));
}

export function factValue(facts: Fact[], key: string): number | null {
  return facts.find((fact) => fact.key === key)?.value ?? null;
}

/** Free cash flow is never tagged directly; it is operating cash less capex. */
export function freeCashFlow(facts: Fact[]): number | null {
  const operating = factValue(facts, "operatingCashFlow");
  const capex = factValue(facts, "capitalExpenditures");
  if (operating === null) return null;
  return operating - Math.abs(capex ?? 0);
}
