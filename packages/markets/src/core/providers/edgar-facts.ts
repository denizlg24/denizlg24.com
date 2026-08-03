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
  fy: z.number().optional(),
  fp: z.string().optional(),
  form: z.string(),
  filed: z.string(),
  frame: z.string().optional(),
});
export type CompanyFactUnit = z.infer<typeof companyFactUnitSchema>;

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
            // A concept whose entries do not match the expected shape is
            // dropped rather than failing the whole several-megabyte payload.
            units: z
              .record(z.string(), z.array(companyFactUnitSchema).catch([]))
              .optional(),
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

function isFiscalPeriod(value: string | undefined): value is FiscalPeriod {
  return (
    value === "FY" ||
    value === "Q1" ||
    value === "Q2" ||
    value === "Q3" ||
    value === "Q4"
  );
}

/**
 * A Q3 10-Q tags income and cash-flow concepts twice: once for the three-month
 * quarter and once for the nine-month year to date. Both carry `fy: 2025`,
 * `fp: "Q3"` and the same `end`, so keying on those three alone collapses them
 * and the year-to-date figure can end up labelled as a single quarter. That
 * value then flows into `trailingFlow`, which sums four quarters, and overstates
 * trailing revenue, net income and cash flow.
 *
 * Balance-sheet facts are instantaneous and carry no `start`, so they pass.
 */
function durationMatchesPeriod(
  entry: CompanyFactUnit,
  period: FiscalPeriod,
): boolean {
  if (!entry.start) return true;
  const days =
    (Date.parse(`${entry.end}T00:00:00Z`) -
      Date.parse(`${entry.start}T00:00:00Z`)) /
    86_400_000;
  if (!Number.isFinite(days)) return false;
  return period === "FY"
    ? days >= 330 && days <= 400
    : days >= 80 && days <= 100;
}

/**
 * Collapses a companyfacts payload into one row per reported period.
 *
 * Two rules keep this honest. Only the first concept present for a key is
 * taken, so a filer tagging both Revenues and the ASC-606 concept does not
 * produce two conflicting revenue lines. And where the same period appears in
 * several filings — an original 10-Q and a later 10-K restating it — the most
 * recently filed value wins.
 *
 * That second rule is enforced per fact key, not per period. A period-level
 * guard would drop every key an older filing was the only one to tag once a
 * newer filing had contributed anything at all to the same period.
 */
export function distillCompanyFacts(
  payload: CompanyFactsPayload,
  options?: { forms?: string[] },
): DistilledPeriod[] {
  const gaap = payload.facts?.["us-gaap"];
  if (!gaap) return [];
  const allowedForms = options?.forms ?? ["10-K", "10-Q", "20-F", "40-F"];

  const periods = new Map<string, DistilledPeriod>();
  const claimed = new Map<string, string>();

  for (const definition of FACT_DEFINITIONS) {
    const concept = definition.concepts.find((name) => gaap[name]?.units);
    if (!concept) continue;
    const units = gaap[concept]?.units;
    if (!units) continue;

    for (const [unit, entries] of Object.entries(units)) {
      for (const entry of entries) {
        if (!allowedForms.includes(entry.form)) continue;
        if (!isFiscalPeriod(entry.fp) || entry.fy === undefined) continue;
        if (!durationMatchesPeriod(entry, entry.fp)) continue;

        const periodKey = `${entry.fy}:${entry.fp}:${entry.end}`;
        const existing = periods.get(periodKey);

        const period =
          existing ??
          ({
            fiscalYear: entry.fy,
            fiscalPeriod: entry.fp,
            periodStart: entry.start,
            periodEnd: entry.end,
            form: entry.form,
            filed: entry.filed,
            accession: entry.accn,
            facts: [],
          } satisfies DistilledPeriod);

        const claimKey = `${periodKey}:${definition.key}`;
        const claimedFiling = claimed.get(claimKey);
        if (claimedFiling !== undefined && claimedFiling >= entry.filed) {
          periods.set(periodKey, period);
          continue;
        }

        period.facts = period.facts.filter(
          (fact) => fact.key !== definition.key,
        );
        period.facts.push({
          key: definition.key,
          label: definition.label,
          statement: definition.statement,
          value: entry.val,
          unit,
          concept,
        });
        claimed.set(claimKey, entry.filed);
        if (entry.filed > period.filed) {
          period.filed = entry.filed;
          period.accession = entry.accn;
          period.form = entry.form;
        }
        periods.set(periodKey, period);
      }
    }
  }

  return [...periods.values()]
    .filter((period) => period.facts.length > 0)
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
