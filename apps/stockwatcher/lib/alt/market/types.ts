/** Wire types for the market and company signal datasets. Safe for client code. */

export type OffExchangePoint = {
  date: string;
  shortVolume: number;
  shortExemptVolume: number;
  totalVolume: number;
  /** Short sale volume divided by off-exchange volume. */
  dpi: number;
};

export type OffExchangeSeries = {
  symbol: string;
  points: OffExchangePoint[];
  latest: OffExchangePoint | null;
  /** Mean DPI over the points before the latest one. */
  baselineDpi: number | null;
  dpiZScore: number | null;
};

export type OffExchangeRow = {
  symbol: string;
  date: string;
  shortVolume: number;
  totalVolume: number;
  dpi: number;
};

export type OffExchangeTop = {
  date: string;
  sort: "dpi" | "volume";
  minVolume: number;
  rows: OffExchangeRow[];
};

export type AtsWeek = {
  weekStart: string;
  atsShares: number | null;
  atsTrades: number | null;
  atsNotional: number | null;
  nonAtsShares: number | null;
  nonAtsTrades: number | null;
  nonAtsNotional: number | null;
};

export type AtsSeries = { symbol: string; weeks: AtsWeek[] };

export type PolymarketTrade = {
  time: number;
  question: string;
  outcome: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  notional: number;
  wallet: string;
  pseudonym: string | null;
  slug: string | null;
  eventSlug: string | null;
};

export type PolymarketTrades = {
  minNotional: number;
  /** finance: only markets under the finance, economy, Fed, stocks, earnings and IPO tags; all: every market. */
  scope: "finance" | "all";
  trades: PolymarketTrade[];
};

export type PolymarketOutcome = { label: string; probability: number | null };

export type PolymarketMarket = {
  id: string;
  conditionId: string | null;
  question: string;
  event: string | null;
  slug: string;
  eventSlug: string | null;
  outcomes: PolymarketOutcome[];
  volume24h: number;
  volume: number;
  liquidity: number;
  endDate: string | null;
  tags: string[];
};

export type PolymarketMarkets = { tag: string; markets: PolymarketMarket[] };

export type PatentRecord = {
  number: string | null;
  applicationNumber: string;
  title: string;
  date: string;
  kind: "grant" | "application";
  applicant: string | null;
  cpc: string[];
};

export type PatentMetrics = {
  trailing90: number;
  /** Trailing 90-day grants for each of the seven preceding 90-day windows, oldest first. */
  priorWindows: number[];
  momentumZ: number | null;
  driftCosine: number | null;
  driftSample: { recent: number; prior: number };
};

export type PatentsTicker = {
  symbol: string;
  names: string[];
  grants: PatentRecord[];
  applications: PatentRecord[];
  metrics: PatentMetrics;
};

export type WarnNotice = {
  state: string;
  company: string;
  location: string | null;
  noticeDate: string | null;
  effectiveDate: string | null;
  employees: number | null;
  type: string | null;
  ticker: string | null;
};

export type WarnFeed = {
  days: number;
  states: { state: string; ok: boolean; count: number; error?: string }[];
  notices: WarnNotice[];
};

export type WarnTicker = { symbol: string; notices: WarnNotice[] };

export type AppRating = {
  trackId: number;
  name: string;
  seller: string;
  rating: number | null;
  ratingCount: number;
  version: string | null;
  releaseDate: string | null;
  url: string | null;
};

export type AppHistoryPoint = {
  date: string;
  apps: { trackId: number; rating: number | null; ratingCount: number }[];
};

export type AppsTicker = {
  symbol: string;
  apps: AppRating[];
  history: AppHistoryPoint[];
};

export type AttentionPoint = { date: string; views: number };

export type AttentionTicker = {
  symbol: string;
  article: string;
  points: AttentionPoint[];
  latest: AttentionPoint | null;
  mean30: number | null;
  zScore30: number | null;
};
