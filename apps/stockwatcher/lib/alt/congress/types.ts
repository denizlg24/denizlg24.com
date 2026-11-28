export type Chamber = "house" | "senate" | "executive";

export type Side = "buy" | "sell" | "partial_sale" | "exchange" | "unknown";

export type Owner = "self" | "spouse" | "joint" | "dependent";

export type Trade = {
  id: string;
  chamber: Chamber;
  filingId: string;
  /** Date the report was filed, YYYY-MM-DD. */
  filedAt: string;
  filer: string;
  bioguide: string | null;
  party: string | null;
  state: string | null;
  owner: Owner | null;
  asset: string;
  ticker: string | null;
  assetType: string | null;
  side: Side;
  transactedAt: string | null;
  notifiedAt: string | null;
  /** Disclosure ranges, not exact values. `amountMax` is null for "Over $X". */
  amountMin: number | null;
  amountMax: number | null;
  amountText: string;
  note: string | null;
  url: string;
  /** Read from a scanned document's OCR text layer; dates and names may be wrong. */
  ocr: boolean;
};

export type FilingKind = "ptr" | "annual";

export type Filing = {
  id: string;
  chamber: Chamber;
  kind: FilingKind;
  filer: string;
  bioguide: string | null;
  state: string | null;
  filedAt: string;
  url: string;
  /** False for scanned paper filings and documents the parser could not read. */
  parsed: boolean;
  tradeCount: number;
  reason: string | null;
};

export type Politician = {
  bioguide: string;
  name: string;
  party: string;
  state: string;
  chamber: "house" | "senate";
  district: number | null;
  url: string | null;
};

export type MemberSummary = Politician & {
  trades: number;
  buys: number;
  sells: number;
  lastTradeAt: string | null;
  tickers: string[];
};

export type Holding = {
  asset: string;
  ticker: string | null;
  assetType: string | null;
  owner: Owner | null;
  valueMin: number | null;
  valueMax: number | null;
  valueText: string;
};

export type NetWorth = {
  filingId: string;
  year: number;
  filedAt: string;
  url: string;
  chamber: "house" | "senate";
  /** Midpoint sums; open-ended ranges ("Over $X") count at X. */
  assetsMid: number | null;
  liabilitiesMid: number | null;
  netWorthMid: number | null;
  assetsLow: number | null;
  assetsHigh: number | null;
  holdings: Holding[];
  holdingsCount: number;
  /** Anything the parser could not read, so the totals are lower bounds. */
  flags: string[];
};

export type TradeFeed = {
  trades: Trade[];
  total: number;
  filings: Filing[];
  /** Filings listed by the publisher whose documents are not read yet. */
  pending: number;
  warnings: string[];
};

export type MemberProfile = {
  member: Politician | null;
  trades: Trade[];
  tradeTotal: number;
  filings: Filing[];
  netWorth: NetWorth | null;
  warnings: string[];
};

export type TickerHolder = {
  filer: string;
  bioguide: string | null;
  party: string | null;
  state: string | null;
  chamber: Chamber;
  trades: number;
  buys: number;
  sells: number;
  lastTradeAt: string | null;
  amountLow: number;
  amountHigh: number | null;
  holding: Holding | null;
};

export type TickerActivity = {
  ticker: string;
  trades: Trade[];
  tradeTotal: number;
  holders: TickerHolder[];
  warnings: string[];
};

export const sideLabel: Record<Side, string> = {
  buy: "Buy",
  sell: "Sell",
  partial_sale: "Sell (partial)",
  exchange: "Exchange",
  unknown: "Unknown",
};

export const isSell = (side: Side) =>
  side === "sell" || side === "partial_sale";

export function amountLabel(min: number | null, max: number | null) {
  const short = (value: number) =>
    value >= 1e6
      ? `$${+(value / 1e6).toFixed(2)}M`
      : value >= 1e3
        ? `$${Math.round(value / 1e3)}K`
        : `$${value}`;
  if (min == null) return "—";
  return max == null ? `> ${short(min)}` : `${short(min)}–${short(max)}`;
}
