import "server-only";
import {
  fetchCompanyFacts,
  lookupCik,
  type CompanyFacts,
  type FactEntry,
} from "@/lib/sec-data";

export type FundamentalFrequency = "annual" | "quarterly" | "all";
export type FactPeriod = "FY" | "Q" | "YTD" | "instant" | "other";

export type FundamentalPoint = {
  end: string;
  start?: string;
  value: number;
  fy: number | null;
  fp: string | null;
  form: string;
  unit: string;
  period: FactPeriod;
};

const CONCEPT_ALIASES: Record<string, string[]> = {
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueGoodsNet",
    "RevenuesNetOfInterestExpense",
    "Revenue",
  ],
  costofrevenue: [
    "CostOfRevenue",
    "CostOfGoodsAndServicesSold",
    "CostOfGoodsSold",
    "CostOfServices",
    "CostOfSales",
  ],
  grossprofit: ["GrossProfit", "GrossProfitLoss"],
  operatingincome: ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"],
  netincome: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  eps: ["EarningsPerShareDiluted", "DilutedEarningsLossPerShare"],
  epsbasic: ["EarningsPerShareBasic", "BasicEarningsLossPerShare"],
  dilutedshares: [
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    "AdjustedWeightedAverageShares",
  ],
  basicshares: ["WeightedAverageNumberOfSharesOutstandingBasic"],
  sharesoutstanding: [
    "EntityCommonStockSharesOutstanding",
    "CommonStockSharesOutstanding",
  ],
  operatingcashflow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    "CashFlowsFromUsedInOperatingActivities",
  ],
  capex: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "PaymentsForCapitalImprovements",
  ],
  depreciation: [
    "DepreciationDepletionAndAmortization",
    "DepreciationAndAmortization",
    "DepreciationAmortizationAndAccretionNet",
  ],
  sharebasedcompensation: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
  rnd: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
  sga: ["SellingGeneralAndAdministrativeExpense"],
  interestexpense: ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"],
  incometax: ["IncomeTaxExpenseBenefit"],
  dividendspaid: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
  buybacks: ["PaymentsForRepurchaseOfCommonStock"],
  cash: [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    "CashAndCashEquivalents",
  ],
  assets: ["Assets"],
  currentassets: ["AssetsCurrent", "CurrentAssets"],
  liabilities: ["Liabilities"],
  currentliabilities: ["LiabilitiesCurrent", "CurrentLiabilities"],
  equity: [
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    "Equity",
  ],
  longtermdebt: [
    "LongTermDebt",
    "LongTermDebtNoncurrent",
    "LongTermDebtAndCapitalLeaseObligations",
    "NoncurrentBorrowings",
  ],
  inventory: ["InventoryNet", "Inventories"],
  receivables: ["AccountsReceivableNetCurrent", "TradeAndOtherCurrentReceivables"],
};

export const conceptAliasNames = Object.keys(CONCEPT_ALIASES);

const TAXONOMIES = ["us-gaap", "ifrs-full", "dei"];
const PREFERRED_UNITS = ["USD", "USD/shares", "shares", "pure"];

const normalizeConcept = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "");

const aliasTags = (name: string) =>
  CONCEPT_ALIASES[normalizeConcept(name)] ?? [name];

const dayMs = 86_400_000;

function classify(entry: FactEntry): FactPeriod {
  if (!entry.start) return "instant";
  const days = (Date.parse(entry.end) - Date.parse(entry.start)) / dayMs;
  if (days >= 350 && days <= 380) return "FY";
  if (days >= 80 && days <= 100) return "Q";
  if (days >= 150 && days <= 290) return "YTD";
  return "other";
}

function pickUnit(units: Record<string, FactEntry[]>) {
  const keys = Object.keys(units);
  return PREFERRED_UNITS.find((unit) => keys.includes(unit)) ?? keys[0];
}

function seriesForTag(facts: CompanyFacts, tag: string): FundamentalPoint[] {
  for (const taxonomy of TAXONOMIES) {
    const concept = facts.facts[taxonomy]?.[tag];
    if (!concept) continue;
    const unit = pickUnit(concept.units);
    if (!unit) continue;
    const byPeriod = new Map<
      string,
      { first: FactEntry; latest: FactEntry }
    >();
    for (const entry of concept.units[unit]) {
      if (!Number.isFinite(entry.val)) continue;
      const key = `${entry.start ?? ""}|${entry.end}`;
      const seen = byPeriod.get(key);
      if (!seen) byPeriod.set(key, { first: entry, latest: entry });
      else {
        if (entry.filed < seen.first.filed) seen.first = entry;
        if (entry.filed >= seen.latest.filed) seen.latest = entry;
      }
    }
    return [...byPeriod.values()].map(({ first, latest }) => {
      const period = classify(latest);
      return {
        end: latest.end,
        ...(latest.start ? { start: latest.start } : {}),
        value: latest.val,
        fy: first.fy ?? null,
        fp: first.fp ?? null,
        form: latest.form,
        unit,
        period,
      };
    });
  }
  return [];
}

export function conceptSeries(facts: CompanyFacts, concept: string) {
  const merged = new Map<string, FundamentalPoint>();
  for (const tag of aliasTags(concept))
    for (const point of seriesForTag(facts, tag)) {
      const key = `${point.start ?? ""}|${point.end}`;
      if (!merged.has(key)) merged.set(key, point);
    }
  return [...merged.values()].sort(
    (a, b) => a.end.localeCompare(b.end) || (a.start ?? "").localeCompare(b.start ?? ""),
  );
}

const keepFrequency = (
  point: FundamentalPoint,
  frequency: FundamentalFrequency,
) => {
  if (frequency === "all") return true;
  if (frequency === "annual")
    return point.period === "FY" || (point.period === "instant" && point.fp === "FY");
  return point.period === "Q" || point.period === "instant";
};

const CACHE_TTL_MS = 6 * 3_600_000;
const MAX_CACHED_POINTS = 600_000;
const cache = new Map<
  string,
  { at: number; points: FundamentalPoint[]; entity: string }
>();
let cachedPoints = 0;

function remember(key: string, entity: string, points: FundamentalPoint[]) {
  const existing = cache.get(key);
  if (existing) cachedPoints -= existing.points.length;
  cache.delete(key);
  cache.set(key, { at: Date.now(), points, entity });
  cachedPoints += points.length;
  for (const [oldest, entry] of cache) {
    if (cachedPoints <= MAX_CACHED_POINTS) break;
    cachedPoints -= entry.points.length;
    cache.delete(oldest);
  }
}

export type SymbolFundamentals = {
  entity: string;
  concepts: Record<string, FundamentalPoint[]>;
};

export async function loadFundamentals(
  symbol: string,
  concepts: string[],
  frequency: FundamentalFrequency,
  sinceYear: number | undefined,
): Promise<SymbolFundamentals | null> {
  const fresh = Date.now() - CACHE_TTL_MS;
  const cached = concepts.map((concept) => cache.get(`${symbol}|${concept}`));
  let entity = "";
  let rows: Array<FundamentalPoint[]>;
  if (cached.every((hit) => hit && hit.at > fresh)) {
    rows = cached.map((hit) => hit?.points ?? []);
    entity = cached[0]?.entity ?? "";
  } else {
    const company = await lookupCik(symbol);
    if (!company) return null;
    const facts = await fetchCompanyFacts(company.cik);
    entity = facts.entityName;
    rows = concepts.map((concept) => {
      const points = conceptSeries(facts, concept);
      remember(`${symbol}|${concept}`, entity, points);
      return points;
    });
  }
  const result: Record<string, FundamentalPoint[]> = {};
  concepts.forEach((concept, index) => {
    result[concept] = rows[index].filter(
      (point) =>
        keepFrequency(point, frequency) &&
        (sinceYear === undefined || Number(point.end.slice(0, 4)) >= sinceYear),
    );
  });
  return { entity, concepts: result };
}
