import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { attempt, round, ticker } from "./shared";
import { readWorkspace, type Identity } from "@/lib/db";
import {
  factorKeys,
  famaFrench,
  type FactorData,
  type FactorKey,
} from "@/lib/french-factors";
import { history, quotes } from "@/lib/market";
import type { ChartPoint } from "@/lib/models";
import { mapLimit } from "@/lib/pool";
import {
  closeOnOrBefore,
  closesOn,
  dailyReturns,
  dayOf,
  driverChanges,
  historicalTail,
  horizonReturns,
  isoDay,
  moments,
  namedScenarios,
  ols,
  parametricTail,
  parseDay,
  portfolioReturns,
  sampleStdev,
  shockDriverKeys,
  shockDrivers,
  annualise,
  univariateBeta,
  unionDays,
  type Scenario,
} from "@/lib/portfolio-risk";
import { regression } from "@/lib/analytics";
import { positionsFor, valuePosition } from "@/lib/portfolio";

const MAX_HOLDINGS = 40;
const FETCH_CONCURRENCY = 6;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const periods = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y"] as const;
type Period = (typeof periods)[number];

type Holding = {
  symbol: string;
  name: string;
  quantity: number;
  value: number;
  weight: number;
};
type Group = {
  currency: string;
  total: number;
  holdings: Holding[];
  omitted: number;
};
type Loaded = {
  scope: string;
  groups: Group[];
  unpriced: string[];
};
type GroupFailure = { currency: string; error: string };

async function loadHoldings(user: Identity, bookId?: string): Promise<Loaded> {
  const { data } = await readWorkspace(user.id);
  const books = bookId
    ? data.books.filter((book) => book.id === bookId)
    : data.books;
  if (bookId && !books.length) throw new Error("That portfolio does not exist.");
  const aggregate = new Map<
    string,
    { symbol: string; currency: string; quantity: number; cost: number; realized: number }
  >();
  for (const book of books)
    for (const position of positionsFor(
      data.trades.filter((trade) => trade.bookId === book.id),
    )) {
      if (position.quantity <= 0) continue;
      const key = `${position.symbol}:${position.currency}`;
      const current = aggregate.get(key);
      if (current) {
        current.quantity += position.quantity;
        current.cost += position.cost;
      } else aggregate.set(key, { ...position });
    }
  const open = [...aggregate.values()];
  if (!open.length)
    throw new Error(
      bookId
        ? "That portfolio has no open positions."
        : "There are no open positions to analyse.",
    );
  const live = await quotes([...new Set(open.map((item) => item.symbol))]).catch(
    () => [],
  );
  const bySymbol = new Map(live.map((quote) => [quote.symbol, quote]));
  const unpriced: string[] = [];
  const byCurrency = new Map<string, Omit<Holding, "weight">[]>();
  for (const position of open) {
    const quote = bySymbol.get(position.symbol);
    const { marketValue } = valuePosition(position, quote);
    if (!marketValue || marketValue <= 0) {
      unpriced.push(position.symbol);
      continue;
    }
    const list = byCurrency.get(position.currency) ?? [];
    list.push({
      symbol: position.symbol,
      name: quote?.name ?? position.symbol,
      quantity: position.quantity,
      value: marketValue,
    });
    byCurrency.set(position.currency, list);
  }
  if (!byCurrency.size)
    throw new Error("None of the open positions could be priced right now.");
  const groups = [...byCurrency].map(([currency, list]): Group => {
    const sorted = list.sort((a, b) => b.value - a.value);
    const kept = sorted.slice(0, MAX_HOLDINGS);
    const total = kept.reduce((sum, item) => sum + item.value, 0);
    return {
      currency,
      total,
      holdings: kept.map((item) => ({ ...item, weight: item.value / total })),
      omitted: sorted.length - kept.length,
    };
  });
  groups.sort((a, b) => b.total - a.total);
  return {
    scope: bookId ? books[0].name : "All portfolios",
    groups,
    unpriced,
  };
}

async function fetchHistories(symbols: string[], years: number) {
  const unique = [...new Set(symbols)];
  const results = await mapLimit(unique, FETCH_CONCURRENCY, (symbol) =>
    history(symbol, years, "1d")
      .then((item) => item.points)
      .catch((): ChartPoint[] => []),
  );
  return new Map(unique.map((symbol, index) => [symbol, results[index]]));
}

async function perGroup<T>(
  groups: Group[],
  run: (group: Group) => Promise<T> | T,
): Promise<(T | GroupFailure)[]> {
  const out: (T | GroupFailure)[] = [];
  for (const group of groups)
    try {
      out.push(await run(group));
    } catch (error) {
      out.push({
        currency: group.currency,
        error:
          error instanceof Error && error.message.length < 300
            ? error.message
            : "The analysis failed.",
      });
    }
  return out;
}

const pointsOf = (histories: Map<string, ChartPoint[]>, symbol: string) =>
  histories.get(symbol) ?? [];

const pct = (value: number | null | undefined, digits = 2) =>
  value == null ? null : round(value * 100, digits);

const header = (loaded: Loaded) => ({
  scope: loaded.scope,
  unpricedPositions: loaded.unpriced,
  currencyNote:
    "Each currency book is analysed separately; nothing is converted or netted across currencies.",
});

const isUsSymbol = (symbol: string) => !/\.[A-Z]{1,3}$/.test(symbol);

const factorLabels: Record<FactorKey, string> = {
  mkt: "Market (Mkt-RF)",
  smb: "Size (SMB)",
  hml: "Value (HML)",
  rmw: "Profitability (RMW)",
  cma: "Investment (CMA)",
  mom: "Momentum (MOM)",
};

function factorGroup(
  group: Group,
  histories: Map<string, ChartPoint[]>,
  ff: FactorData,
  years: number,
) {
  const firstDay = ff.last - Math.round(years * 365.25);
  const days = ff.days.filter((day) => day >= firstDay);
  const series = group.holdings.map((holding) =>
    dailyReturns(closesOn(pointsOf(histories, holding.symbol), days)),
  );
  const portfolio = portfolioReturns(
    group.holdings.map((holding) => holding.weight),
    series,
  );
  const y: number[] = [];
  const x: number[][] = [];
  const used: number[] = [];
  portfolio.returns.forEach((value, t) => {
    const row = ff.rows.get(days[t + 1]);
    if (value == null || !row) return;
    y.push(value - row.rf);
    x.push(factorKeys.map((key) => row[key]));
    used.push(days[t + 1]);
  });
  const fit = ols(y, x);
  if (!fit)
    throw new Error("Not enough overlapping history to run the factor regression.");
  const factorMeans = factorKeys.map(
    (_, i) => x.reduce((sum, row) => sum + row[i], 0) / x.length,
  );
  const nonUs =
    group.currency !== "USD" ||
    group.holdings.some((holding) => !isUsSymbol(holding.symbol));
  return {
    currency: group.currency,
    value: round(group.total),
    positions: group.holdings.length,
    window: {
      from: isoDay(used[0]),
      to: isoDay(used.at(-1)!),
      observations: fit.observations,
    },
    coveragePercent: pct(portfolio.coverage, 1),
    alphaAnnualPercent: round(annualise(fit.coefficients[0]) * 100),
    alphaTStat: round(fit.tStats[0]),
    r2: round(fit.r2, 3),
    adjustedR2: round(fit.adjustedR2, 3),
    residualVolAnnualPercent: round(fit.residualStdev * Math.sqrt(252) * 100),
    factors: factorKeys.map((key, i) => ({
      factor: key,
      label: factorLabels[key],
      beta: round(fit.coefficients[i + 1], 3),
      tStat: round(fit.tStats[i + 1]),
      annualContributionPercent: round(
        annualise(fit.coefficients[i + 1] * factorMeans[i]) * 100,
      ),
    })),
    ...(nonUs
      ? {
          caveat:
            "Fama-French factors are built from US stocks; for non-US or non-USD holdings the loadings are indicative only and the R² will usually be low.",
        }
      : {}),
  };
}

async function factors(loaded: Loaded, years: number) {
  const [ff, histories] = await Promise.all([
    famaFrench(),
    fetchHistories(
      loaded.groups.flatMap((group) => group.holdings.map((item) => item.symbol)),
      years + 0.3,
    ),
  ]);
  return {
    analysis: "factors" as const,
    ...header(loaded),
    model: "Fama-French 5 factors + momentum, daily, OLS on excess returns",
    method:
      "Current weights held constant over the window; daily portfolio return minus the risk-free rate regressed on the six factors. t-stats are plain OLS (no autocorrelation adjustment).",
    factorsThrough: isoDay(ff.last),
    groups: await perGroup(loaded.groups, (group) =>
      factorGroup(group, histories, ff, years),
    ),
    source: "Kenneth R. French Data Library; Yahoo Finance (adjusted closes)",
  };
}

const periodStart = (period: Period, now: Date) => {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  switch (period) {
    case "1M":
      date.setUTCMonth(date.getUTCMonth() - 1);
      break;
    case "3M":
      date.setUTCMonth(date.getUTCMonth() - 3);
      break;
    case "6M":
      date.setUTCMonth(date.getUTCMonth() - 6);
      break;
    case "YTD":
      return Date.UTC(now.getUTCFullYear(), 0, 1) / 86_400_000;
    case "1Y":
      date.setUTCFullYear(date.getUTCFullYear() - 1);
      break;
    case "3Y":
      date.setUTCFullYear(date.getUTCFullYear() - 3);
      break;
    case "5Y":
      date.setUTCFullYear(date.getUTCFullYear() - 5);
      break;
  }
  return Math.floor(date.getTime() / 86_400_000);
};

const yearsBack = (fromDay: number) =>
  Math.min(30, Math.max(0.3, (dayOf(Date.now() / 1000) - fromDay) / 365.25 + 0.1));

async function attribution(
  loaded: Loaded,
  benchmark: string,
  period: Period,
  from?: string,
  to?: string,
) {
  const today = dayOf(Date.now() / 1000);
  const fromDay = from ? parseDay(from) : periodStart(period, new Date());
  const toDay = to ? Math.min(parseDay(to), today) : today;
  if (!(fromDay < toDay)) throw new Error("The start date must be before the end date.");
  const symbols = loaded.groups.flatMap((group) =>
    group.holdings.map((item) => item.symbol),
  );
  const histories = await fetchHistories([...symbols, benchmark], yearsBack(fromDay));
  const benchPoints = pointsOf(histories, benchmark);
  const b0 = closeOnOrBefore(benchPoints, fromDay);
  const b1 = closeOnOrBefore(benchPoints, toDay);
  if (b0 == null || b1 == null)
    throw new Error(`No ${benchmark} history covers ${isoDay(fromDay)} to ${isoDay(toDay)}.`);
  const benchReturn = b1 / b0 - 1;
  const groups = await perGroup(loaded.groups, (group) => {
    const rows = group.holdings.flatMap((holding) => {
      const points = pointsOf(histories, holding.symbol);
      const p0 = closeOnOrBefore(points, fromDay);
      const p1 = closeOnOrBefore(points, toDay);
      return p0 && p1
        ? [{ holding, startValue: holding.quantity * p0, ret: p1 / p0 - 1 }]
        : [];
    });
    const missing = group.holdings
      .filter((holding) => !rows.some((row) => row.holding === holding))
      .map((holding) => holding.symbol);
    const start = rows.reduce((sum, row) => sum + row.startValue, 0);
    if (!start) throw new Error("No holding has price history covering the period.");
    const positions = rows
      .map((row) => {
        const weight = row.startValue / start;
        return {
          symbol: row.holding.symbol,
          startWeightPercent: pct(weight),
          returnPercent: pct(row.ret),
          contributionPercent: pct(weight * row.ret, 3),
          activeContributionPercent: pct(weight * (row.ret - benchReturn), 3),
          contribution: weight * row.ret,
        };
      })
      .sort((a, b) => b.contribution - a.contribution);
    const portfolioReturn = positions.reduce((sum, row) => sum + row.contribution, 0);
    const covered =
      rows.reduce((sum, row) => sum + row.holding.value, 0) / group.total;
    return {
      currency: group.currency,
      value: round(group.total),
      portfolioReturnPercent: pct(portfolioReturn),
      benchmarkReturnPercent: pct(benchReturn),
      activeReturnPercent: pct(portfolioReturn - benchReturn),
      coveredPercent: pct(covered, 1),
      uncoveredSymbols: missing,
      topContributors: positions
        .filter((row) => row.contribution > 0)
        .slice(0, 5)
        .map((row) => row.symbol),
      topDetractors: positions
        .filter((row) => row.contribution < 0)
        .slice(-5)
        .reverse()
        .map((row) => row.symbol),
      positions: positions.slice(0, 30).map((row) => ({
        symbol: row.symbol,
        startWeightPercent: row.startWeightPercent,
        returnPercent: row.returnPercent,
        contributionPercent: row.contributionPercent,
        activeContributionPercent: row.activeContributionPercent,
      })),
      omittedPositions: Math.max(0, positions.length - 30),
    };
  });
  return {
    analysis: "attribution" as const,
    ...header(loaded),
    benchmark,
    from: isoDay(fromDay),
    to: isoDay(toDay),
    assumption:
      "Buy-and-hold of the CURRENT share counts from the start date (no trade-level timing; positions bought or sold during the period are not reflected). Total returns from adjusted closes in each security's own currency; holdings without a price at the start date are excluded and the rest renormalised.",
    groups,
    source: "Yahoo Finance (adjusted closes)",
  };
}

type Resolved = Scenario & { fromDay: number; toDay: number };

function resolveScenarios(
  keys: string[] | undefined,
  from?: string,
  to?: string,
): Resolved[] {
  const wanted = new Set(keys ?? namedScenarios.map((item) => item.key));
  if (from && to) wanted.add("custom");
  const out: Resolved[] = namedScenarios
    .filter((item) => wanted.has(item.key))
    .map((item) => ({
      ...item,
      fromDay: parseDay(item.from),
      toDay: parseDay(item.to),
    }));
  if (wanted.has("custom")) {
    if (!from || !to)
      throw new Error("A custom scenario needs both from and to dates.");
    const fromDay = parseDay(from);
    const toDay = parseDay(to);
    if (!(fromDay < toDay)) throw new Error("The start date must be before the end date.");
    out.push({ key: "custom", label: `Custom ${from} to ${to}`, from, to, fromDay, toDay });
  }
  return out;
}

function stressScenario(
  group: Group,
  histories: Map<string, ChartPoint[]>,
  benchPoints: ChartPoint[],
  scenario: Resolved,
) {
  const b0 = closeOnOrBefore(benchPoints, scenario.fromDay);
  const b1 = closeOnOrBefore(benchPoints, scenario.toDay);
  if (b0 == null || b1 == null) return null;
  const benchReturn = b1 / b0 - 1;
  const rows = group.holdings.map((holding) => {
    const points = pointsOf(histories, holding.symbol);
    const p0 = closeOnOrBefore(points, scenario.fromDay);
    const p1 = closeOnOrBefore(points, scenario.toDay);
    if (p0 && p1)
      return { holding, ret: p1 / p0 - 1, proxied: false, beta: null };
    const fit = regression(points, benchPoints);
    const beta = fit?.beta ?? 1;
    return {
      holding,
      ret: Math.max(-1, beta * benchReturn),
      proxied: true,
      beta: fit ? beta : null,
    };
  });
  const detailed = rows
    .map((row) => ({
      symbol: row.holding.symbol,
      weightPercent: pct(row.holding.weight),
      returnPercent: pct(row.ret),
      pnl: row.holding.value * row.ret,
      proxied: row.proxied,
      beta: round(row.beta, 2),
      assumedBeta: row.proxied && row.beta == null,
    }))
    .sort((a, b) => a.pnl - b.pnl);
  const pnl = detailed.reduce((sum, row) => sum + row.pnl, 0);
  const proxiedValue = rows
    .filter((row) => row.proxied)
    .reduce((sum, row) => sum + row.holding.value, 0);
  return {
    key: scenario.key,
    label: scenario.label,
    from: scenario.from,
    to: scenario.to,
    portfolioReturnPercent: pct(pnl / group.total),
    pnl: round(pnl),
    benchmarkReturnPercent: pct(benchReturn),
    proxiedPercentOfValue: pct(proxiedValue / group.total, 1),
    positions: detailed.slice(0, 12).map((row) => ({ ...row, pnl: round(row.pnl) })),
    omittedPositions: Math.max(0, detailed.length - 12),
    othersPnl: round(detailed.slice(12).reduce((sum, row) => sum + row.pnl, 0)),
  };
}

async function historicalStress(
  loaded: Loaded,
  benchmark: string,
  scenarios: Resolved[],
) {
  const earliest = Math.min(...scenarios.map((item) => item.fromDay));
  const symbols = loaded.groups.flatMap((group) =>
    group.holdings.map((item) => item.symbol),
  );
  const histories = await fetchHistories([...symbols, benchmark], yearsBack(earliest));
  const benchPoints = pointsOf(histories, benchmark);
  return {
    kind: "historical" as const,
    benchmark,
    method:
      "Each holding's actual total return over the window applied to today's market value. Holdings with no price at the window start are proxied as beta x benchmark return (beta from their available history; 1.0 if too little) and flagged. Benchmark and proxy are in the benchmark's currency terms.",
    groups: await perGroup(loaded.groups, (group) => ({
      currency: group.currency,
      value: round(group.total),
      scenarios: scenarios.map((scenario) => ({
        ...(stressScenario(group, histories, benchPoints, scenario) ?? {
          key: scenario.key,
          label: scenario.label,
          from: scenario.from,
          to: scenario.to,
          unavailable: `No ${benchmark} data covers this window.`,
        }),
      })),
    })),
  };
}

type Shock = { driver: keyof typeof shockDrivers; size: number };

async function factorShocks(loaded: Loaded, shocks: Shock[], years: number) {
  const symbols = loaded.groups.flatMap((group) =>
    group.holdings.map((item) => item.symbol),
  );
  const drivers = [...new Set(shocks.map((shock) => shockDrivers[shock.driver].symbol))];
  const histories = await fetchHistories([...symbols, ...drivers], years + 0.1);
  const results = await perGroup(loaded.groups, (group) => {
    const firstDay = dayOf(Date.now() / 1000) - Math.round(years * 365.25);
    const days = unionDays(
      group.holdings.map((holding) => pointsOf(histories, holding.symbol)),
      firstDay,
      dayOf(Date.now() / 1000),
    );
    const series = group.holdings.map((holding) =>
      dailyReturns(closesOn(pointsOf(histories, holding.symbol), days)),
    );
    return {
      currency: group.currency,
      value: round(group.total),
      shocks: shocks.map((shock) => {
        const driver = shockDrivers[shock.driver];
        const closes = closesOn(pointsOf(histories, driver.symbol), days);
        if (closes.every((value) => value == null))
          return {
            driver: shock.driver,
            label: driver.label,
            size: shock.size,
            unit: driver.unit,
            unavailable: `No ${driver.symbol} data was available.`,
          };
        const changes = driverChanges(closes, driver.mode);
        const move = shock.size * driver.scale;
        const rows = group.holdings.map((holding, i) => {
          const fit = univariateBeta(series[i], changes);
          return {
            symbol: holding.symbol,
            weightPercent: pct(holding.weight),
            beta: round(fit?.beta, 3),
            r2: round(fit?.r2, 3),
            pnl: fit ? holding.value * fit.beta * move : null,
          };
        });
        const pnl = rows.reduce((sum, row) => sum + (row.pnl ?? 0), 0);
        const ordered = rows.sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0));
        return {
          driver: shock.driver,
          label: driver.label,
          symbol: driver.symbol,
          size: shock.size,
          unit: driver.unit,
          pnl: round(pnl),
          portfolioReturnPercent: pct(pnl / group.total),
          positions: ordered
            .slice(0, 12)
            .map((row) => ({ ...row, pnl: round(row.pnl) })),
          omittedPositions: Math.max(0, ordered.length - 12),
          othersPnl: round(
            ordered.slice(12).reduce((sum, row) => sum + (row.pnl ?? 0), 0),
          ),
        };
      }),
    };
  });
  return {
    kind: "factor" as const,
    method: `Each holding's daily return regressed (OLS, ${years}y) on the driver's daily change, one driver at a time; P/L = market value x beta x shock. Univariate betas ignore correlation between drivers and assume the past relationship holds; low R² means a weak estimate.`,
    groups: results,
  };
}

const horizons = [1, 10] as const;
const confidences = [0.95, 0.99] as const;

function varGroup(
  group: Group,
  histories: Map<string, ChartPoint[]>,
  years: number,
) {
  const today = dayOf(Date.now() / 1000);
  const days = unionDays(
    group.holdings.map((holding) => pointsOf(histories, holding.symbol)),
    today - Math.round(years * 365.25),
    today,
  );
  const series = group.holdings.map((holding) =>
    dailyReturns(closesOn(pointsOf(histories, holding.symbol), days)),
  );
  const portfolio = portfolioReturns(
    group.holdings.map((holding) => holding.weight),
    series,
  );
  const dated = portfolio.returns.flatMap((value, t) =>
    value == null ? [] : [{ day: days[t + 1], value }],
  );
  const daily = dated.map((item) => item.value);
  if (daily.length < 120)
    throw new Error("Not enough overlapping price history for VaR.");
  const sigma = sampleStdev(daily);
  const shape = moments(daily);
  const measures = horizons.flatMap((horizon) => {
    const sample = horizonReturns(daily, horizon);
    return confidences.map((confidence) => {
      const hist = historicalTail(sample, confidence);
      const param = parametricTail(sigma, horizon, confidence);
      const money = (fraction: number | undefined) =>
        fraction == null ? null : round(fraction * group.total, 0);
      return {
        horizonDays: horizon,
        confidence: confidence * 100,
        historicalVarPercent: pct(hist?.var),
        historicalEsPercent: pct(hist?.es),
        parametricVarPercent: pct(param.var),
        parametricEsPercent: pct(param.es),
        historicalVar: money(hist?.var),
        historicalEs: money(hist?.es),
        parametricVar: money(param.var),
        parametricEs: money(param.es),
        scenarios: sample.length,
      };
    });
  });
  const worst = [...dated].sort((a, b) => a.value - b.value).slice(0, 3);
  return {
    currency: group.currency,
    value: round(group.total),
    window: {
      from: isoDay(dated[0].day),
      to: isoDay(dated.at(-1)!.day),
      observations: daily.length,
    },
    dailyVolPercent: pct(sigma, 3),
    annualVolPercent: pct(sigma * Math.sqrt(252)),
    skew: round(shape.skew),
    excessKurtosis: round(shape.excessKurtosis),
    coveragePercent: pct(portfolio.coverage, 1),
    measures,
    worstDays: worst.map((item) => ({
      date: isoDay(item.day),
      returnPercent: pct(item.value),
    })),
  };
}

async function valueAtRisk(loaded: Loaded, years: number) {
  const histories = await fetchHistories(
    loaded.groups.flatMap((group) => group.holdings.map((item) => item.symbol)),
    years + 0.1,
  );
  return {
    analysis: "var" as const,
    ...header(loaded),
    method:
      "Historical simulation applies today's weights to every past day (10-day uses overlapping compounded windows); parametric assumes normally distributed returns with zero drift. VaR/ES are loss magnitudes at the stated confidence, in each currency's units. Fat tails (see kurtosis) make parametric figures understate historical ones.",
    groups: await perGroup(loaded.groups, (group) => varGroup(group, histories, years)),
    source: "Yahoo Finance (adjusted closes)",
  };
}

export function riskTools({ user }: { user: Identity }) {
  return {
    getPortfolioRisk: tool({
      description:
        "Portfolio-level risk on the user's CURRENT holdings (loaded automatically; optionally one bookId), computed per currency from daily adjusted-close history, never netted across currencies. analysis: 'factors' = Fama-French 5 + momentum regression of the portfolio's excess returns (betas, t-stats, R², annualised alpha; US factors, data lags ~1-2 months); 'attribution' = return vs a benchmark over a period with per-position contribution, active return and top contributors/detractors (buy-and-hold of current share counts, not trade-timed); 'stress' = historical replays (gfc2008, covid2020, rates2022, q42018, or custom from/to) and/or factor shocks via 'shocks' (rates in bp, oil/usd/equity in %, vix in points; estimated P/L per position); 'var' = historical and parametric 1-day and 10-day VaR and expected shortfall at 95/99%. Heavy: one call fetches history for every holding.",
      inputSchema: z.object({
        analysis: z.enum(["factors", "attribution", "stress", "var"]),
        bookId: z
          .string()
          .optional()
          .describe("Limit to one portfolio; omit for all portfolios."),
        years: z
          .number()
          .min(1)
          .max(10)
          .default(3)
          .describe("History window for factors, var and factor shocks."),
        benchmark: ticker
          .default("^GSPC")
          .describe("Benchmark for attribution and the beta proxy in stress."),
        period: z
          .enum(periods)
          .default("1Y")
          .describe("Attribution period when from/to are not given."),
        from: z
          .string()
          .regex(DAY_PATTERN)
          .optional()
          .describe("YYYY-MM-DD: custom attribution start or custom stress window start."),
        to: z
          .string()
          .regex(DAY_PATTERN)
          .optional()
          .describe("YYYY-MM-DD: custom attribution end or custom stress window end."),
        scenarios: z
          .array(z.enum(["gfc2008", "covid2020", "rates2022", "q42018", "custom"]))
          .max(5)
          .optional()
          .describe(
            "Historical stress windows; default all four named ones (plus custom when from/to are given). Pass an empty list with shocks to run only factor shocks.",
          ),
        shocks: z
          .array(
            z.object({
              driver: z.enum(shockDriverKeys),
              size: z
                .number()
                .describe(
                  "rates: bp (+100 = yields up 1pp); oil, usd, equity: percent move; vix: index points.",
                ),
            }),
          )
          .max(5)
          .optional(),
      }),
      execute: (input) =>
        attempt(async () => {
          const loaded = await loadHoldings(user, input.bookId);
          if (input.analysis === "factors") return factors(loaded, input.years);
          if (input.analysis === "var") return valueAtRisk(loaded, input.years);
          if (input.analysis === "attribution")
            return attribution(
              loaded,
              input.benchmark,
              input.period,
              input.from,
              input.to,
            );
          const scenarios = resolveScenarios(
            input.scenarios,
            input.from,
            input.to,
          );
          const runHistorical = scenarios.length > 0;
          if (!runHistorical && !input.shocks?.length)
            throw new Error("Choose at least one scenario or shock.");
          return {
            analysis: "stress" as const,
            ...header(loaded),
            historical: runHistorical
              ? await historicalStress(loaded, input.benchmark, scenarios)
              : null,
            shocks: input.shocks?.length
              ? await factorShocks(loaded, input.shocks, input.years)
              : null,
            source: "Yahoo Finance (adjusted closes)",
          };
        }, "Portfolio risk is temporarily unavailable."),
    }),
  };
}
