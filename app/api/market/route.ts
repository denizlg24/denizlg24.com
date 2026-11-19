import { supportedStartDate } from "@/lib/assistant-types";
import { isMoex } from "@/lib/moex";
import { currentUser, json } from "@/lib/auth";
import { comparison, members, quotes, search, series } from "@/lib/market";
import {
  ranges,
  symbolPattern,
  universes,
  type Range,
  type Universe,
} from "@/lib/universes";

export async function GET(request: Request) {
  if (!(await currentUser()))
    return json({ error: "Sign in to view market data." }, 401);
  const args = new URL(request.url).searchParams;
  const since = args.get("since") ?? undefined;
  if (since && !supportedStartDate(since))
    return json({ error: "Invalid chart start date." }, 400);
  try {
    if (args.has("q")) {
      const query = args.get("q")!.trim();
      if (!query || query.length > 100)
        return json({ error: "Enter a company name or symbol." }, 400);
      return json(await search(query));
    }
    if (args.has("compare")) {
      const symbols = [
        ...new Set(args.get("compare")!.toUpperCase().split(",")),
      ];
      const range = args.get("range") ?? "3M";
      if (
        symbols.length < 2 ||
        symbols.length > 6 ||
        symbols.some((symbol) => !symbolPattern.test(symbol)) ||
        !["1M", "3M", "6M", "YTD", "1Y"].includes(range)
      )
        return json(
          { error: "Choose 2 to 6 symbols and a valid comparison period." },
          400,
        );
      return json(await comparison(symbols, range as Range, since));
    }
    if (args.has("symbol")) {
      const symbol = args.get("symbol")!.toUpperCase();
      const range = args.get("range") || "1M";
      if (!symbolPattern.test(symbol) || !Object.hasOwn(ranges, range))
        return json({ error: "Invalid symbol or period." }, 400);
      const result = await series(symbol, range as Range, since);
      return json(result);
    }
    const universe = args.get("universe");
    let group: ReturnType<typeof members> = [];
    if (universe) {
      if (!Object.hasOwn(universes, universe))
        return json({ error: "Unknown market group." }, 400);
      group = members(universe as Universe);
    }
    const parseSymbols = (key: string) =>
      (args.get(key) ?? "")
        .split(",")
        .filter(Boolean)
        .map((symbol) => symbol.toUpperCase());
    const additional = parseSymbols("symbols");
    const removals = parseSymbols("exclude");
    if (
      [additional, removals].some(
        (list) =>
          list.length > 120 ||
          list.some((symbol) => !symbolPattern.test(symbol)),
      )
    ) {
      return json({ error: "Choose up to 120 valid ticker symbols." }, 400);
    }
    const excluded = new Set(removals);
    const symbols = [
      ...new Set([...group.map((item) => item.symbol), ...additional]),
    ].filter((symbol) => !excluded.has(symbol));
    const grouped = new Set(group.map((item) => item.symbol));
    group = [
      ...group.filter((item) => !excluded.has(item.symbol)),
      ...symbols
        .filter((symbol) => !grouped.has(symbol))
        .map((symbol) => ({ symbol, name: symbol })),
    ];
    if (symbols.length === 0)
      return json({ quotes: [], members: [], missing: [], source: "" });
    const data = await quotes(symbols, since);
    if (data.length === 0)
      return json(
        { error: "No quotes returned. Check the symbols or try refreshing." },
        502,
      );
    return json({
      quotes: data,
      members: group,
      missing: symbols.filter(
        (symbol) => !data.some((quote) => quote.symbol === symbol),
      ),
      source: symbols.every(isMoex)
        ? "Moscow Exchange"
        : symbols.some(isMoex)
          ? "Yahoo Finance · Moscow Exchange"
          : "Yahoo Finance",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Market data unavailable.";
    return json({ error: message }, message === "Symbol not found" ? 404 : 502);
  }
}
