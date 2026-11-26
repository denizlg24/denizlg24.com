import type { Quote } from "@repo/markets/schemas";

/** IBKR listing exchange → Yahoo suffix, with the minor unit Yahoo quotes it in. */
const venues: Record<
  string,
  { suffix: string; minor?: Record<string, string> }
> = {
  NASDAQ: { suffix: "" },
  NYSE: { suffix: "" },
  ARCA: { suffix: "" },
  AMEX: { suffix: "" },
  BATS: { suffix: "" },
  IEX: { suffix: "" },
  PINK: { suffix: "" },
  LSE: { suffix: ".L", minor: { GBP: "GBp" } },
  LSEETF: { suffix: ".L", minor: { GBP: "GBp" } },
  LSEIOB1: { suffix: ".IL" },
  SBF: { suffix: ".PA" },
  AEB: { suffix: ".AS" },
  ENEXT_BE: { suffix: ".BR" },
  "ENEXT.BE": { suffix: ".BR" },
  EBR: { suffix: ".BR" },
  BVL: { suffix: ".LS" },
  ISED: { suffix: ".IR" },
  IBIS: { suffix: ".DE" },
  IBIS2: { suffix: ".DE" },
  XETRA: { suffix: ".DE" },
  FWB: { suffix: ".F" },
  FWB2: { suffix: ".F" },
  GETTEX: { suffix: ".MU" },
  SWB: { suffix: ".SG" },
  EBS: { suffix: ".SW" },
  SWX: { suffix: ".SW" },
  VIRTX: { suffix: ".SW" },
  BVME: { suffix: ".MI" },
  "BVME.ETF": { suffix: ".MI" },
  BM: { suffix: ".MC" },
  VSE: { suffix: ".VI" },
  WSE: { suffix: ".WA" },
  SFB: { suffix: ".ST" },
  CPH: { suffix: ".CO" },
  KFB: { suffix: ".CO" },
  OSE: { suffix: ".OL" },
  HEX: { suffix: ".HE" },
  TSE: { suffix: ".TO" },
  VENTURE: { suffix: ".V" },
  ASX: { suffix: ".AX" },
  SEHK: { suffix: ".HK" },
  TSEJ: { suffix: ".T" },
  SGX: { suffix: ".SI" },
  NSE: { suffix: ".NS" },
  JSE: { suffix: ".JO", minor: { ZAR: "ZAc" } },
  TASE: { suffix: ".TA", minor: { ILS: "ILA" } },
  MEXI: { suffix: ".MX" },
};

const relayTicker = /^[A-Z0-9.^=:-]{1,24}$/;
const STALE_AFTER_MS = 14 * 86_400_000;

export interface QuoteLine {
  ticker: string;
  /** What Yahoo quotes the line in: the position's currency, or its minor unit. */
  currency: string;
  /** Quote units per major unit of the position's currency. */
  scale: number;
}

/** The default Yahoo line for an IBKR listing, or null when the venue is unmapped. */
export function yahooLine(
  symbol: string,
  exchange: string,
  currency: string,
): QuoteLine | null {
  const venue = venues[exchange.trim().toUpperCase()];
  if (!venue) return null;
  let base = symbol.trim().toUpperCase().replace(/[ .]/g, "-");
  if (venue.suffix === ".HK") base = base.padStart(4, "0");
  const ticker = `${base}${venue.suffix}`;
  if (!relayTicker.test(ticker)) return null;
  const unit = venue.minor?.[currency];
  return { ticker, currency: unit ?? currency, scale: unit ? 100 : 1 };
}

/**
 * Yahoo keys secondary-currency lines of one listing as BASE-CCY.SUFFIX
 * (GOLD.PA is a dead USD line, GOLD-EUR.PA the live EUR one). Minor-unit lines
 * never use the form, and a suffix-less ticker has nowhere to put it.
 */
export function currencyLine(line: QuoteLine): QuoteLine | null {
  if (line.scale !== 1) return null;
  const dot = line.ticker.lastIndexOf(".");
  if (dot <= 0) return null;
  const ticker = `${line.ticker.slice(0, dot)}-${line.currency}${line.ticker.slice(dot)}`;
  return relayTicker.test(ticker) ? { ...line, ticker } : null;
}

export type Probe = "live" | "wrong" | "unknown";

/**
 * `quote` is undefined when the relay answered without the ticker, which only
 * proves the line is dead if the answer itself was complete.
 */
export function probeQuote(
  quote: Pick<Quote, "ts" | "currency"> | undefined,
  line: QuoteLine,
  now: number,
  complete: boolean,
): Probe {
  if (!quote) return complete ? "wrong" : "unknown";
  const fresh = now - Date.parse(quote.ts) < STALE_AFTER_MS;
  return fresh && quote.currency === line.currency ? "live" : "wrong";
}

/** The `-CCY` line worth probing, only when the default is provably wrong. */
export function alternativeFor(line: QuoteLine, probe: Probe | undefined) {
  return probe === "wrong" ? currencyLine(line) : null;
}

/** Keeps the default line unless the alternative is provably live. */
export function chooseLine(
  line: QuoteLine,
  alternative: QuoteLine | null | undefined,
  alternativeProbe: Probe | undefined,
) {
  return alternative && alternativeProbe === "live" ? alternative : line;
}
