import "server-only";
import { legislators } from "../congress/legislators";
import type { Legislator } from "../congress/match";
import { requestBudget, warmerBudget } from "../congress/pool";
import type { StoredNetWorth } from "../congress/schemas";
import {
  congressFeed,
  type Feed,
  houseAnnualReports,
  houseNetWorth,
  refreshAnnual,
  refreshCongress,
  senateAnnualFilings,
} from "../congress/store";
import {
  type Chamber,
  isSell,
  type MemberProfile,
  type MemberSummary,
  type NetWorth,
  type TickerActivity,
  type TickerHolder,
  type Trade,
  type TradeFeed,
} from "../congress/types";
import type { AltHandlers, AltWarmer } from "../handler-types";
import { AltBadRequest, type AltResult } from "../types";

const SOURCE =
  "House Clerk, Senate eFD, OGE, unitedstates/congress-legislators";

const int = (
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
) => {
  const raw = params.get(name);
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new AltBadRequest(
      `${name} must be an integer from ${min} to ${max}.`,
    );
  return value;
};

const chamberParam = (params: URLSearchParams): Chamber | "all" => {
  const value = params.get("chamber") ?? "all";
  if (value === "house" || value === "senate" || value === "all") return value;
  throw new AltBadRequest("chamber must be house, senate or all.");
};

const symbolParam = (params: URLSearchParams, required = false) => {
  const value = params.get("symbol")?.trim().toUpperCase() ?? "";
  if (!value) {
    if (required) throw new AltBadRequest("symbol is required.");
    return null;
  }
  if (!/^[A-Z0-9.^-]{1,12}$/.test(value))
    throw new AltBadRequest("symbol is not a valid ticker.");
  return value;
};

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const cutoff = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

function wrap<T>(feed: Feed, data: T): AltResult<T> {
  return {
    data,
    source: SOURCE,
    asOf: feed.asOf,
    fetchedAt: feed.fetchedAt,
    stale: feed.stale,
  };
}

async function memberFilter(q: string | null) {
  if (!q) return null;
  const text = q.trim();
  if (/^[A-Z]\d{6}$/.test(text)) return { bioguide: text, needle: null };
  let roster: Legislator[] = [];
  try {
    roster = (await legislators()).value;
  } catch {}
  const needle = norm(text);
  const hit = roster.find(
    (l) =>
      norm(l.name).includes(needle) ||
      norm(`${l.first}${l.last}`).includes(needle),
  );
  return { bioguide: hit?.bioguide ?? null, needle };
}

const matchesMember = (
  trade: Trade,
  filter: { bioguide: string | null; needle: string | null },
) =>
  (filter.bioguide != null && trade.bioguide === filter.bioguide) ||
  (filter.needle != null && norm(trade.filer).includes(filter.needle));

const sameSymbol = (trade: Trade, symbol: string) =>
  trade.ticker != null && norm(trade.ticker) === norm(symbol);

function selectTrades(
  trades: Trade[],
  options: {
    symbol: string | null;
    days: number;
    party: string | null;
    side: string | null;
  },
) {
  const since = cutoff(options.days);
  return trades.filter(
    (trade) =>
      trade.filedAt >= since &&
      (!options.symbol || sameSymbol(trade, options.symbol)) &&
      (!options.party ||
        trade.party?.toLowerCase().startsWith(options.party.toLowerCase())) &&
      (!options.side ||
        (options.side === "buy"
          ? trade.side === "buy"
          : options.side === "sell"
            ? isSell(trade.side)
            : true)),
  );
}

const unparsed = (feed: Feed, since: string) =>
  feed.filings
    .filter((filing) => !filing.parsed && filing.filedAt >= since)
    .slice(0, 50);

function toNetWorth(report: StoredNetWorth): NetWorth {
  return {
    filingId: report.filingId,
    year: report.year,
    filedAt: report.filedAt,
    url: report.url,
    chamber: report.chamber,
    assetsMid: report.assetsMid,
    liabilitiesMid: report.liabilitiesMid,
    netWorthMid: report.netWorthMid,
    assetsLow: report.assetsLow,
    assetsHigh: report.assetsHigh,
    holdings: report.holdings.slice(0, 150),
    holdingsCount: report.holdingsCount,
    flags: report.flags,
  };
}

const handlers: AltHandlers = {
  "congress.trades": async (params) => {
    const chamber = chamberParam(params);
    const days = int(params, "days", 90, 1, 730);
    const limit = int(params, "limit", 100, 1, 500);
    const feed = await congressFeed({ chamber, budget: requestBudget() });
    const member = await memberFilter(params.get("member"));
    const filtered = selectTrades(feed.trades, {
      symbol: symbolParam(params),
      days,
      party: params.get("party"),
      side: params.get("side"),
    }).filter((trade) => !member || matchesMember(trade, member));
    const data: TradeFeed = {
      trades: filtered.slice(0, limit),
      total: filtered.length,
      filings: unparsed(feed, cutoff(days)),
      pending: feed.pending,
      warnings: feed.warnings,
    };
    return wrap(feed, data);
  },

  "congress.member": async (params) => {
    const query = params.get("bioguide") ?? params.get("member");
    if (!query) throw new AltBadRequest("bioguide is required.");
    const filter = await memberFilter(query);
    const roster = (await legislators()).value;
    const person = roster.find((l) => l.bioguide === filter?.bioguide) ?? null;
    const feed = await congressFeed({
      chamber: person ? person.chamber : "all",
      budget: requestBudget(),
    });
    const trades = feed.trades.filter((trade) =>
      filter ? matchesMember(trade, filter) : false,
    );
    const warnings = [...feed.warnings];
    let netWorth: NetWorth | null = null;
    let extra: MemberProfile["filings"] = [];
    if (person?.chamber === "house") {
      try {
        const report = await houseNetWorth(person, requestBudget());
        netWorth = report ? toNetWorth(report) : null;
        if (!report) warnings.push("No annual report found for this member.");
      } catch {
        warnings.push("Annual report could not be read right now.");
      }
    } else if (person?.chamber === "senate") {
      extra = await senateAnnualFilings(person).catch(() => []);
      warnings.push(
        "Senate annual reports are linked, not parsed; no net-worth estimate.",
      );
    }
    const data: MemberProfile = {
      member: person && {
        bioguide: person.bioguide,
        name: person.name,
        party: person.party,
        state: person.state,
        chamber: person.chamber,
        district: person.district,
        url: person.url,
      },
      trades: trades.slice(0, 300),
      tradeTotal: trades.length,
      filings: [
        ...feed.filings.filter((f) =>
          filter ? f.bioguide === filter.bioguide : false,
        ),
        ...extra,
      ]
        .sort((a, b) => b.filedAt.localeCompare(a.filedAt))
        .slice(0, 40),
      netWorth,
      warnings,
    };
    return wrap(feed, data);
  },

  "congress.members": async (params) => {
    const chamber = chamberParam(params);
    const days = int(params, "days", 365, 1, 730);
    const limit = int(params, "limit", 100, 1, 600);
    const q = norm(params.get("q") ?? "");
    const party = params.get("party")?.toLowerCase() ?? null;
    const [feed, roster] = await Promise.all([
      congressFeed({ chamber, budget: requestBudget() }),
      legislators(),
    ]);
    const since = cutoff(days);
    const summaries = new Map<string, MemberSummary>();
    for (const person of roster.value) {
      if (chamber !== "all" && person.chamber !== chamber) continue;
      if (party && !person.party.toLowerCase().startsWith(party)) continue;
      if (q && !norm(person.name).includes(q)) continue;
      summaries.set(person.bioguide, {
        bioguide: person.bioguide,
        name: person.name,
        party: person.party,
        state: person.state,
        chamber: person.chamber,
        district: person.district,
        url: person.url,
        trades: 0,
        buys: 0,
        sells: 0,
        lastTradeAt: null,
        tickers: [],
      });
    }
    const tickers = new Map<string, Set<string>>();
    for (const trade of feed.trades) {
      const row = trade.bioguide ? summaries.get(trade.bioguide) : undefined;
      if (!row || trade.filedAt < since) continue;
      row.trades++;
      if (trade.side === "buy") row.buys++;
      if (isSell(trade.side)) row.sells++;
      const day = trade.transactedAt ?? trade.filedAt;
      if (!row.lastTradeAt || day > row.lastTradeAt) row.lastTradeAt = day;
      if (trade.ticker) {
        const set = tickers.get(row.bioguide) ?? new Set<string>();
        set.add(trade.ticker);
        tickers.set(row.bioguide, set);
      }
    }
    const list = [...summaries.values()]
      .map((row) => ({
        ...row,
        tickers: [...(tickers.get(row.bioguide) ?? [])].slice(0, 12),
      }))
      .sort((a, b) => b.trades - a.trades || a.name.localeCompare(b.name))
      .slice(0, limit);
    return wrap(feed, {
      members: list,
      total: summaries.size,
      warnings: feed.warnings,
    });
  },

  "congress.holdings": async (params) => {
    const symbol = symbolParam(params, true) ?? "";
    const days = int(params, "days", 730, 1, 730);
    const limit = int(params, "limit", 100, 1, 500);
    const feed = await congressFeed({
      chamber: "all",
      budget: requestBudget(),
    });
    const matched = selectTrades(feed.trades, {
      symbol,
      days,
      party: null,
      side: null,
    });
    const warnings = [...feed.warnings];
    const held = new Map<string, StoredNetWorth["holdings"][number]>();
    try {
      for (const report of (await houseAnnualReports(requestBudget()))
        .reports) {
        const holding = report.holdings.find(
          (h) => h.ticker != null && norm(h.ticker) === norm(symbol),
        );
        if (holding && report.bioguide) held.set(report.bioguide, holding);
      }
    } catch {
      warnings.push("Annual holdings are not read yet.");
    }
    const holders = new Map<string, TickerHolder>();
    const holder = (
      key: string,
      seed: Omit<
        TickerHolder,
        | "trades"
        | "buys"
        | "sells"
        | "lastTradeAt"
        | "amountLow"
        | "amountHigh"
        | "holding"
      >,
    ) => {
      const existing = holders.get(key);
      if (existing) return existing;
      const created: TickerHolder = {
        ...seed,
        trades: 0,
        buys: 0,
        sells: 0,
        lastTradeAt: null,
        amountLow: 0,
        amountHigh: 0,
        holding: seed.bioguide ? (held.get(seed.bioguide) ?? null) : null,
      };
      holders.set(key, created);
      return created;
    };
    for (const trade of matched) {
      const row = holder(trade.bioguide ?? `name:${norm(trade.filer)}`, {
        filer: trade.filer,
        bioguide: trade.bioguide,
        party: trade.party,
        state: trade.state,
        chamber: trade.chamber,
      });
      row.trades++;
      if (trade.side === "buy") row.buys++;
      if (isSell(trade.side)) row.sells++;
      const day = trade.transactedAt ?? trade.filedAt;
      if (!row.lastTradeAt || day > row.lastTradeAt) row.lastTradeAt = day;
      row.amountLow += trade.amountMin ?? 0;
      row.amountHigh =
        row.amountHigh == null || trade.amountMax == null
          ? null
          : row.amountHigh + trade.amountMax;
    }
    const roster = (await legislators().catch(() => null))?.value ?? [];
    for (const [bioguide, holding] of held) {
      const person = roster.find((l) => l.bioguide === bioguide);
      if (!person) continue;
      holder(bioguide, {
        filer: person.name,
        bioguide,
        party: person.party,
        state: person.state,
        chamber: person.chamber,
      }).holding = holding;
    }
    const data: TickerActivity = {
      ticker: symbol,
      trades: matched.slice(0, limit),
      tradeTotal: matched.length,
      holders: [...holders.values()]
        .sort((a, b) => b.trades - a.trades || a.filer.localeCompare(b.filer))
        .slice(0, 100),
      warnings,
    };
    return wrap(feed, data);
  },

  "trump.trades": async (params) => {
    const days = int(params, "days", 365, 1, 730);
    const limit = int(params, "limit", 100, 1, 500);
    const feed = await congressFeed({
      chamber: "executive",
      budget: requestBudget(),
    });
    const filtered = selectTrades(feed.trades, {
      symbol: symbolParam(params),
      days,
      party: null,
      side: params.get("side"),
    });
    const warnings = [
      "OGE 278-T filings are scanned documents; trades are read from OCR text, so names and dates can be wrong. Amounts are ranges.",
      ...feed.warnings,
    ];
    const data: TradeFeed = {
      trades: filtered.slice(0, limit),
      total: filtered.length,
      filings: unparsed(feed, cutoff(days)),
      pending: feed.pending,
      warnings,
    };
    return wrap(feed, data);
  },
};

const warmers: AltWarmer[] = [
  {
    name: "congress.trades",
    everyMs: 10 * 60_000,
    run: () => refreshCongress(warmerBudget(400)),
  },
  {
    name: "congress.annual",
    everyMs: 6 * 3_600_000,
    run: () => refreshAnnual(warmerBudget(120)),
  },
];

export { handlers, warmers };
