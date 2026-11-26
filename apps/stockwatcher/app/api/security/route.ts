import constituents from "@/data/sp500.json";
import { currentUser, json } from "@/lib/auth";
import { RelayUnavailable, relay } from "@/lib/relay-data";
import type { Relationships } from "@/lib/security-types";
import { benchmarks, symbolPattern, universes } from "@/lib/universes";

const functions = [
  "des",
  "anr",
  "hds",
  "ern",
  "fa",
  "dvd",
  "cn",
  "mgmt",
  "rels",
] as const;
type Fn = (typeof functions)[number];
const isFn = (value: string): value is Fn =>
  (functions as readonly string[]).includes(value);
const moverLists = ["gainers", "losers", "actives"] as const;
const sp500 = new Set(constituents.map((item) => item.symbol));

function memberships(ticker: string) {
  const groups = Object.entries(universes)
    .filter(([, members]) => (members as readonly string[]).includes(ticker))
    .map(([name]) => name);
  return sp500.has(ticker) ? ["S&P 500", ...groups] : groups;
}

async function settle<T>(promise: Promise<T>) {
  try {
    return await promise;
  } catch {
    return null;
  }
}

async function load(fn: Fn, ticker: string, args: URLSearchParams) {
  switch (fn) {
    case "des": {
      const [instrument, stats] = await Promise.all([
        relay.instrument(ticker),
        settle(relay.stats(ticker)),
      ]);
      return { instrument, stats };
    }
    case "anr":
      return relay.analysts(ticker);
    case "hds":
      return relay.holders(ticker);
    case "ern":
      return relay.earnings(ticker);
    case "mgmt":
      return relay.people(ticker);
    case "dvd":
      return relay.actions(ticker);
    case "cn":
      return relay.news(ticker, 25);
    case "fa": {
      const statement = args.get("statement");
      const frequency = args.get("frequency");
      return relay.financials(
        ticker,
        statement === "balance" || statement === "cashFlow"
          ? statement
          : "income",
        frequency === "quarterly" ? "quarterly" : "yearly",
      );
    }
    case "rels": {
      const [peers, holders, people, instrument] = await Promise.all([
        settle(relay.peers(ticker)),
        settle(relay.holders(ticker)),
        settle(relay.people(ticker)),
        settle(relay.instrument(ticker)),
      ]);
      if (!peers && !holders && !people && !instrument)
        throw new RelayUnavailable(502, "Relationship data is unavailable.");
      const result: Relationships = {
        ticker,
        name: instrument?.symbol.name ?? ticker,
        sector: peers?.sector ?? instrument?.profile.sector ?? null,
        industry: peers?.industry ?? instrument?.profile.industry ?? null,
        peers: peers?.peers ?? [],
        holders: holders?.institutions.slice(0, 8) ?? [],
        officers: people?.officers.slice(0, 8) ?? [],
        indices: memberships(ticker),
      };
      return result;
    }
  }
}

export async function GET(request: Request) {
  if (!(await currentUser()))
    return json({ error: "Sign in to view security data." }, 401);
  const args = new URL(request.url).searchParams;
  try {
    const movers = args.get("movers");
    if (movers) {
      const list = moverLists.find((item) => item === movers);
      if (!list) return json({ error: "Unknown movers list." }, 400);
      return json(await relay.movers(list, 30));
    }
    if (args.has("macro")) {
      const series = (args.get("macro") ?? "").toUpperCase();
      if (!series) return json(await relay.macroCatalog());
      if (!/^[A-Z0-9]{2,20}$/.test(series))
        return json({ error: "Invalid series." }, 400);
      return json(await relay.macro(series, args.get("from") ?? undefined));
    }
    const ticker = (args.get("symbol") ?? "").toUpperCase();
    const fn = (args.get("fn") ?? "").toLowerCase();
    if (!symbolPattern.test(ticker) || !isFn(fn))
      return json({ error: "Choose a valid symbol and function." }, 400);
    if (ticker.startsWith("^") && fn !== "cn" && fn !== "rels")
      return json(
        {
          error: `${Object.hasOwn(benchmarks, ticker) ? "This benchmark" : ticker} is an index; company functions do not apply.`,
        },
        422,
      );
    return json(await load(fn, ticker, args));
  } catch (error) {
    if (error instanceof RelayUnavailable)
      return json({ error: error.message }, error.status);
    return json({ error: "Security data unavailable." }, 502);
  }
}
