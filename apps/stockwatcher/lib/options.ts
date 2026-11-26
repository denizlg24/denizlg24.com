import "server-only";
import { yahooAuthed } from "./market";

const RISK_FREE = 0.04;
const YEAR_SECONDS = 365 * 86400;
const SETTLEMENT_OFFSET = 21 * 3600;

type SourceContract = {
  strike?: number;
  lastPrice?: number;
  bid?: number;
  ask?: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility?: number;
};
type SourceChain = {
  optionChain?: {
    result?: Array<{
      expirationDates?: number[];
      quote?: {
        regularMarketPrice?: number;
        currency?: string;
        earningsTimestamp?: number;
        earningsTimestampStart?: number;
      };
      options?: Array<{
        expirationDate?: number;
        calls?: SourceContract[];
        puts?: SourceContract[];
      }>;
    }>;
  };
};

export type OptionSide = "call" | "put";
export type Contract = {
  strike: number;
  bid: number | null;
  ask: number | null;
  last: number | null;
  mid: number | null;
  volume: number;
  openInterest: number;
  iv: number | null;
  ivSource: "yahoo" | "mid" | null;
  delta: number | null;
};
export type StrikeRow = { strike: number; call?: Contract; put?: Contract };
export type ExpirySummary = {
  expiry: string;
  daysToExpiry: number;
  atmIv: number | null;
  put10Iv: number | null;
  call10Iv: number | null;
  put25DeltaIv: number | null;
  call25DeltaIv: number | null;
  riskReversal25: number | null;
  putCallVolume: number | null;
  putCallOpenInterest: number | null;
  callVolume: number;
  putVolume: number;
  callOpenInterest: number;
  putOpenInterest: number;
  maxPain: number | null;
  straddle: { strike: number; mid: number } | null;
  impliedMovePercent: number | null;
  strikes: StrikeRow[];
};
type Analysis = ExpirySummary & { T: number };

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const positive = (value: unknown): value is number =>
  finite(value) && value > 0;
const dateOf = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

function cdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly =
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = (Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI)) * poly;
  return x >= 0 ? 1 - tail : tail;
}

function d1(spot: number, strike: number, vol: number, T: number) {
  return (
    (Math.log(spot / strike) + (RISK_FREE + (vol * vol) / 2) * T) /
    (vol * Math.sqrt(T))
  );
}

export function blackScholes(
  side: OptionSide,
  spot: number,
  strike: number,
  vol: number,
  T: number,
) {
  const a = d1(spot, strike, vol, T);
  const b = a - vol * Math.sqrt(T);
  const discount = Math.exp(-RISK_FREE * T);
  return side === "call"
    ? spot * cdf(a) - strike * discount * cdf(b)
    : strike * discount * cdf(-b) - spot * cdf(-a);
}

export function bsDelta(
  side: OptionSide,
  spot: number,
  strike: number,
  vol: number,
  T: number,
) {
  const call = cdf(d1(spot, strike, vol, T));
  return side === "call" ? call : call - 1;
}

export function impliedVol(
  side: OptionSide,
  price: number,
  spot: number,
  strike: number,
  T: number,
) {
  const intrinsic =
    side === "call"
      ? Math.max(0, spot - strike * Math.exp(-RISK_FREE * T))
      : Math.max(0, strike * Math.exp(-RISK_FREE * T) - spot);
  if (price <= intrinsic + 1e-6) return null;
  let low = 0.01;
  let high = 5;
  if (blackScholes(side, spot, strike, high, T) < price) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (blackScholes(side, spot, strike, mid, T) < price) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function contractFrom(
  side: OptionSide,
  raw: SourceContract,
  spot: number,
  T: number,
): Contract | null {
  if (!positive(raw.strike)) return null;
  const bid = positive(raw.bid) ? raw.bid : null;
  const ask = positive(raw.ask) && (bid == null || raw.ask >= bid) ? raw.ask : null;
  const last = positive(raw.lastPrice) ? raw.lastPrice : null;
  const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
  const reference = mid ?? last;
  const fromMid =
    mid != null ? impliedVol(side, mid, spot, raw.strike, T) : null;
  const reported =
    positive(raw.impliedVolatility) &&
    raw.impliedVolatility > 0.03 &&
    raw.impliedVolatility < 4
      ? raw.impliedVolatility
      : null;
  // Yahoo's IV is stale or nonsensical for illiquid and deep-ITM strikes;
  // trust it only when it reprices close to the current mid.
  const trusted =
    reported != null &&
    (reference == null ||
      Math.abs(blackScholes(side, spot, raw.strike, reported, T) - reference) <=
        Math.max(0.05 * reference, ask != null && bid != null ? ask - bid : 0));
  const iv = trusted ? reported : fromMid;
  return {
    strike: raw.strike,
    bid,
    ask,
    last,
    mid,
    volume: finite(raw.volume) ? raw.volume : 0,
    openInterest: finite(raw.openInterest) ? raw.openInterest : 0,
    iv,
    ivSource: iv == null ? null : trusted ? "yahoo" : "mid",
    delta: iv == null ? null : bsDelta(side, spot, raw.strike, iv, T),
  };
}

type SmilePoint = { strike: number; iv: number };

/** Linear interpolation of IV across strikes; null outside the quoted range. */
function interpolate(points: SmilePoint[], strike: number) {
  if (points.length < 2) return null;
  if (strike < points[0].strike || strike > points.at(-1)!.strike) return null;
  const upper = points.findIndex((point) => point.strike >= strike);
  if (upper <= 0) return points[Math.max(upper, 0)].iv;
  const a = points[upper - 1];
  const b = points[upper];
  return a.iv + ((b.iv - a.iv) * (strike - a.strike)) / (b.strike - a.strike);
}

function ivAtDelta(contracts: Contract[], target: number) {
  const usable = contracts
    .filter(
      (item): item is Contract & { iv: number; delta: number } =>
        item.iv != null && item.delta != null,
    )
    .sort((a, b) => a.strike - b.strike);
  for (let i = 1; i < usable.length; i++) {
    const a = usable[i - 1];
    const b = usable[i];
    const lo = Math.min(a.delta, b.delta);
    const hi = Math.max(a.delta, b.delta);
    if (target >= lo && target <= hi && a.delta !== b.delta)
      return a.iv + ((b.iv - a.iv) * (target - a.delta)) / (b.delta - a.delta);
  }
  return null;
}

function maxPain(calls: Contract[], puts: Contract[]) {
  const strikes = [...new Set([...calls, ...puts].map((item) => item.strike))];
  if (!strikes.some((strike) => strike > 0)) return null;
  let best: { strike: number; pain: number } | null = null;
  for (const candidate of strikes) {
    const pain =
      calls.reduce(
        (sum, item) => sum + item.openInterest * Math.max(0, candidate - item.strike),
        0,
      ) +
      puts.reduce(
        (sum, item) => sum + item.openInterest * Math.max(0, item.strike - candidate),
        0,
      );
    if (!best || pain < best.pain) best = { strike: candidate, pain };
  }
  return best && calls.concat(puts).some((item) => item.openInterest > 0)
    ? best.strike
    : null;
}

const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

function analyze(
  chain: NonNullable<NonNullable<SourceChain["optionChain"]>["result"]>[number],
  expiration: number,
  spot: number,
  window: number,
  rows: number,
): Analysis | null {
  const set = chain.options?.[0];
  if (!set) return null;
  const T = Math.max(
    (expiration + SETTLEMENT_OFFSET - Date.now() / 1000) / YEAR_SECONDS,
    1 / 365 / 24,
  );
  const calls = (set.calls ?? []).flatMap((raw) => contractFrom("call", raw, spot, T) ?? []);
  const puts = (set.puts ?? []).flatMap((raw) => contractFrom("put", raw, spot, T) ?? []);
  if (!calls.length && !puts.length) return null;

  const smile: SmilePoint[] = [
    ...puts.filter((item) => item.strike < spot),
    ...calls.filter((item) => item.strike >= spot),
  ]
    .flatMap((item) => (item.iv == null ? [] : [{ strike: item.strike, iv: item.iv }]))
    .sort((a, b) => a.strike - b.strike);
  const otmPuts = puts.filter((item) => item.strike < spot);
  const otmCalls = calls.filter((item) => item.strike > spot);
  const atmIv = interpolate(smile, spot);
  const put25 = ivAtDelta(otmPuts, -0.25);
  const call25 = ivAtDelta(otmCalls, 0.25);

  const strikes = [...new Set([...calls, ...puts].map((item) => item.strike))].sort(
    (a, b) => a - b,
  );
  const nearest = strikes.reduce<number | null>(
    (best, strike) =>
      best == null || Math.abs(strike - spot) < Math.abs(best - spot) ? strike : best,
    null,
  );
  const callAt = calls.find((item) => item.strike === nearest);
  const putAt = puts.find((item) => item.strike === nearest);
  const price = (item?: Contract) => item?.mid ?? item?.last ?? null;
  const straddleMid =
    nearest != null && price(callAt) != null && price(putAt) != null
      ? price(callAt)! + price(putAt)!
      : null;

  const near = strikes
    .filter((strike) => Math.abs(strike / spot - 1) <= window)
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
    .slice(0, rows)
    .sort((a, b) => a - b);
  const callVolume = calls.reduce((sum, item) => sum + item.volume, 0);
  const putVolume = puts.reduce((sum, item) => sum + item.volume, 0);
  const callOpenInterest = calls.reduce((sum, item) => sum + item.openInterest, 0);
  const putOpenInterest = puts.reduce((sum, item) => sum + item.openInterest, 0);
  return {
    T,
    expiry: dateOf(expiration),
    daysToExpiry: Math.max(0, Math.round((expiration + SETTLEMENT_OFFSET - Date.now() / 1000) / 86400)),
    atmIv,
    put10Iv: interpolate(smile, spot * 0.9),
    call10Iv: interpolate(smile, spot * 1.1),
    put25DeltaIv: put25,
    call25DeltaIv: call25,
    riskReversal25: put25 != null && call25 != null ? call25 - put25 : null,
    putCallVolume: ratio(putVolume, callVolume),
    putCallOpenInterest: ratio(putOpenInterest, callOpenInterest),
    callVolume,
    putVolume,
    callOpenInterest,
    putOpenInterest,
    maxPain: maxPain(calls, puts),
    straddle:
      nearest != null && straddleMid != null
        ? { strike: nearest, mid: straddleMid }
        : null,
    impliedMovePercent: straddleMid != null ? (straddleMid / spot) * 100 : null,
    strikes: near.map((strike) => ({
      strike,
      call: calls.find((item) => item.strike === strike),
      put: puts.find((item) => item.strike === strike),
    })),
  };
}

export type EarningsMove = {
  date: string;
  expiry: string;
  straddleMovePercent: number | null;
  eventMovePercent: number | null;
  basis: string;
};

export type OptionsReport = {
  symbol: string;
  spot: number;
  currency: string | null;
  expiries: string[];
  analyses: Analysis[];
  earnings: EarningsMove | null;
  nextEarningsDate: string | null;
  asOf: string;
};

const fetchChain = (symbol: string, expiration?: number) =>
  yahooAuthed<SourceChain>(
    `/v7/finance/options/${encodeURIComponent(symbol)}`,
    expiration ? { date: String(expiration) } : {},
    60,
  ).then((data) => {
    const result = data.optionChain?.result?.[0];
    if (!result) throw new Error(`No listed options were found for ${symbol}.`);
    return result;
  });

export type OptionsRequest = {
  symbol: string;
  expiry?: string;
  count: number;
  windowPercent: number;
  tableRows: number;
  earningsDate?: string | null;
};

export async function optionsReport(request: OptionsRequest): Promise<OptionsReport> {
  const first = await fetchChain(request.symbol);
  const spot = first.quote?.regularMarketPrice;
  const available = (first.expirationDates ?? []).filter(finite).sort((a, b) => a - b);
  if (!positive(spot) || !available.length)
    throw new Error(`No listed options were found for ${request.symbol}.`);

  const now = Date.now() / 1000;
  const upcoming = available.filter((item) => item + SETTLEMENT_OFFSET > now);
  const startAt = request.expiry
    ? Math.max(
        0,
        upcoming.findIndex((item) => dateOf(item) >= request.expiry!),
      )
    : 0;
  if (request.expiry && !upcoming.some((item) => dateOf(item) >= request.expiry!))
    throw new Error(`No expiry on or after ${request.expiry} is listed.`);
  const chosen = upcoming.slice(startAt, startAt + request.count);

  const quoteEarnings =
    first.quote?.earningsTimestampStart ?? first.quote?.earningsTimestamp;
  const earningsDate =
    request.earningsDate ??
    (positive(quoteEarnings) && quoteEarnings > now - 86400
      ? dateOf(quoteEarnings)
      : null);
  // First expiry strictly after the report date always contains the event,
  // whether the company reports before the open or after the close.
  const postIndex = earningsDate
    ? upcoming.findIndex((item) => dateOf(item) > earningsDate)
    : -1;
  const post = postIndex >= 0 ? upcoming[postIndex] : null;
  // An expiry on the report date itself may already contain a before-open move.
  const pre = earningsDate
    ? (upcoming.findLast((item) => dateOf(item) < earningsDate) ?? null)
    : null;

  const wanted = [...new Set([...chosen, ...(post ? [post] : []), ...(pre ? [pre] : [])])];
  const chains = new Map<number, Awaited<ReturnType<typeof fetchChain>>>();
  const loaded = await Promise.all(
    wanted.map((expiration) =>
      expiration === first.options?.[0]?.expirationDate
        ? first
        : fetchChain(request.symbol, expiration).catch(() => null),
    ),
  );
  wanted.forEach((expiration, index) => {
    const chain = loaded[index];
    if (chain) chains.set(expiration, chain);
  });

  const window = request.windowPercent / 100;
  const analysisFor = (expiration: number, rows: number) => {
    const chain = chains.get(expiration);
    return chain ? analyze(chain, expiration, spot, window, rows) : null;
  };
  const analyses = chosen.flatMap((expiration, index) => {
    const result = analysisFor(expiration, index === 0 ? request.tableRows : 0);
    return result ? [result] : [];
  });
  if (!analyses.length)
    throw new Error(`Option quotes for ${request.symbol} are unavailable.`);

  let earnings: EarningsMove | null = null;
  if (earningsDate && post) {
    const after = analysisFor(post, 0);
    const before = pre ? analysisFor(pre, 0) : null;
    if (after) {
      let eventMovePercent: number | null = null;
      if (before?.atmIv != null && after.atmIv != null && before.T > 0) {
        const variance = after.atmIv ** 2 * after.T - before.atmIv ** 2 * before.T;
        // E|move| = sigma * sqrt(2/pi) for a normal move.
        if (variance > 0) eventMovePercent = Math.sqrt(variance) * Math.sqrt(2 / Math.PI) * 100;
      }
      earnings = {
        date: earningsDate,
        expiry: after.expiry,
        straddleMovePercent: after.impliedMovePercent,
        eventMovePercent,
        basis: before
          ? `eventMovePercent isolates the report from forward variance between the ${before.expiry} and ${after.expiry} ATM IVs; straddleMovePercent is the raw ${after.expiry} ATM straddle and includes ordinary days before expiry`
          : `no earlier expiry is listed, so only the raw ${after.expiry} straddle (which includes ordinary days before expiry) is available`,
      };
    }
  }

  return {
    symbol: request.symbol,
    spot,
    currency: first.quote?.currency ?? null,
    expiries: upcoming.map(dateOf),
    analyses,
    earnings,
    nextEarningsDate: earningsDate,
    asOf: new Date().toISOString(),
  };
}
