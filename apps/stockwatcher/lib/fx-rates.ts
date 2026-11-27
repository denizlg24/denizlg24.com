import type { Quote } from "./models";

const minorUnits: Record<string, { major: string; divisor: number }> = {
  GBp: { major: "GBP", divisor: 100 },
  ZAc: { major: "ZAR", divisor: 100 },
  ILA: { major: "ILS", divisor: 100 },
};

export type FxRate = {
  currency: string;
  base: string;
  /** Base-currency value of one unit of `currency` (a penny for GBp). */
  rate: number;
  /** Same pair one session earlier, when Yahoo reports it. */
  previousRate: number | null;
  pair: string;
  time: number;
  source: string;
};

type Leg = { rate: number; previous: number | null; time: number };

export const pairOf = (from: string, to: string) => `${from}${to}=X`;

/** GBp → { major: "GBP", divisor: 100 }; a major currency maps to itself. */
export const majorOf = (code: string) =>
  minorUnits[code] ?? { major: code, divisor: 1 };

/** Yahoo FX symbols that could be needed to value `currencies` in `base`. */
export function fxSymbols(currencies: string[], base: string) {
  const needed = new Set(
    currencies.map((code) => minorUnits[code]?.major ?? code),
  );
  needed.delete(base);
  const wanted = new Set<string>();
  for (const code of needed) {
    wanted.add(pairOf(code, base));
    wanted.add(pairOf(base, code));
    if (code !== "USD" && base !== "USD") {
      wanted.add(pairOf(code, "USD"));
      wanted.add(pairOf("USD", code));
    }
  }
  if (needed.size && base !== "USD") {
    wanted.add(pairOf("USD", base));
    wanted.add(pairOf(base, "USD"));
  }
  return [...wanted];
}

/**
 * Base-currency value of one unit of each currency. Currencies Yahoo cannot
 * price against the base (directly, inverted or via USD) are absent from the
 * result; callers must exclude them rather than assume parity.
 */
export function resolveFxRates(
  live: Quote[],
  currencies: string[],
  base: string,
) {
  const majors = new Map(
    currencies.map((code) => [
      code,
      minorUnits[code] ?? { major: code, divisor: 1 },
    ]),
  );
  const bySymbol = new Map(live.map((quote) => [quote.symbol, quote]));
  const leg = (from: string, to: string): { leg: Leg; pair: string } | null => {
    const direct = bySymbol.get(pairOf(from, to));
    if (direct && direct.price > 0)
      return {
        pair: pairOf(from, to),
        leg: {
          rate: direct.price,
          previous:
            direct.previous && direct.previous > 0 ? direct.previous : null,
          time: direct.time,
        },
      };
    const inverse = bySymbol.get(pairOf(to, from));
    if (inverse && inverse.price > 0)
      return {
        pair: `1/${pairOf(to, from)}`,
        leg: {
          rate: 1 / inverse.price,
          previous:
            inverse.previous && inverse.previous > 0
              ? 1 / inverse.previous
              : null,
          time: inverse.time,
        },
      };
    return null;
  };
  const major = (code: string) => {
    if (code === base)
      return { rate: 1, previous: 1, time: 0, pair: "identity" };
    const direct = leg(code, base);
    if (direct) return { ...direct.leg, pair: direct.pair };
    const toUsd = leg(code, "USD");
    const fromUsd = leg("USD", base);
    if (!toUsd || !fromUsd) return null;
    return {
      rate: toUsd.leg.rate * fromUsd.leg.rate,
      previous:
        toUsd.leg.previous != null && fromUsd.leg.previous != null
          ? toUsd.leg.previous * fromUsd.leg.previous
          : null,
      time: Math.min(toUsd.leg.time, fromUsd.leg.time),
      pair: `${toUsd.pair} x ${fromUsd.pair}`,
    };
  };
  const rates = new Map<string, FxRate>();
  for (const [code, { major: parent, divisor }] of majors) {
    const found = major(parent);
    if (!found) continue;
    rates.set(code, {
      currency: code,
      base,
      rate: found.rate / divisor,
      previousRate: found.previous == null ? null : found.previous / divisor,
      pair: divisor === 1 ? found.pair : `${found.pair} / ${divisor}`,
      time: found.time,
      source: found.pair === "identity" ? "same currency" : "Yahoo Finance",
    });
  }
  return rates;
}

export type CurrencyTotal = {
  currency: string;
  positions: number;
  unpriced: number;
  marketValue: number;
  cost: number;
  unrealized: number;
  dayChange: number;
};

const digits = (value: number, places = 2) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** Converts per-currency totals into one base-currency NAV, skipping currencies with no FX rate. */
export function baseValuation(
  totals: CurrencyTotal[],
  rates: Map<string, FxRate>,
  base: string,
) {
  let marketValue = 0;
  let cost = 0;
  let unrealized = 0;
  let dayChange = 0;
  let previousValue = 0;
  let included = 0;
  const excluded: { currency: string; positions: number }[] = [];
  for (const item of totals) {
    const fx = rates.get(item.currency);
    if (!fx) {
      if (item.positions - item.unpriced > 0)
        excluded.push({
          currency: item.currency,
          positions: item.positions - item.unpriced,
        });
      continue;
    }
    included += item.positions - item.unpriced;
    marketValue += item.marketValue * fx.rate;
    cost += item.cost * fx.rate;
    unrealized += item.unrealized * fx.rate;
    dayChange += item.dayChange * fx.rate;
    previousValue +=
      (item.marketValue - item.dayChange) * (fx.previousRate ?? fx.rate);
  }
  const fxMove = marketValue - dayChange - previousValue;
  return {
    rates,
    block: {
      currency: base,
      marketValue: digits(marketValue),
      unrealized: digits(unrealized),
      unrealizedPercent: cost ? digits((unrealized / cost) * 100) : null,
      dayChange: digits(dayChange + fxMove),
      dayChangePercent: previousValue
        ? digits(((dayChange + fxMove) / previousValue) * 100)
        : null,
      pricedPositions: included,
      excludedNoFxRate: excluded,
      fx: [...rates.values()].map((fx) => ({
        currency: fx.currency,
        pair: fx.pair,
        rate: digits(fx.rate, 6),
        asOf: fx.time > 0 ? new Date(fx.time * 1000).toISOString() : null,
        source: fx.source,
      })),
      method:
        "Market value and day change convert each currency's total at the live rate (day change also includes the FX move since the previous close). Unrealized is local-currency P&L converted at the live rate, so it excludes FX gains or losses since purchase. Positions whose currency has no FX rate are excluded, not converted at 1.",
    },
  };
}
