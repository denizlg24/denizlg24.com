import { z } from "zod";
import { currentUser, json, sameOrigin } from "@/lib/auth";
import { readWorkspace } from "@/lib/db";
import { search, quotes } from "@/lib/market";
import { companyResearch } from "@/lib/research";
import { universes, symbolPattern } from "@/lib/universes";
import { managers } from "@/lib/research-types";
import { amount, percent } from "@/lib/utils";
import { aiResearch, aiResearchEnabled } from "@/lib/ai-research";
import { dashboardSchema, type AssistantResult } from "@/lib/assistant-types";
import { editDashboard, parseStart } from "@/lib/assistant-commands";

const prompt = z.object({
  query: z.string().trim().min(1).max(500),
  web: z.boolean().optional(),
  symbol: z.string().regex(symbolPattern).optional(),
  dashboard: dashboardSchema.optional(),
});
const presets = [
  [/s&p|sp500/i, "S&P 500"],
  [/europe|euro stoxx/i, "Europe leaders"],
  [/semiconductors|\bchips\b|\bAI stocks\b/i, "AI & chips"],
  [/energy stocks|oil stocks/i, "Energy"],
  [/healthcare stocks|pharma stocks/i, "Healthcare"],
  [/japan|asia|hong kong/i, "Asia leaders"],
  [/crypto/i, "Crypto"],
  [/magnificent\s*(?:7|seven)|\bmag\s*7\b/i, "Magnificent Seven"],
  [
    /russia(?:n)?(?: market| stocks)?|moscow exchange|\bmoex\b/i,
    "Russian market",
  ],
  [/\bbanks\b|banking stocks/i, "Banks"],
  [/us stocks|us leaders|american market/i, "US leaders"],
] as const;
const ignore = new Set([
  "I",
  "A",
  "US",
  "EU",
  "AI",
  "ETF",
  "CEO",
  "SEC",
  "EPS",
  "USD",
  "DKK",
  "EUR",
  "CIK",
]);
const setQuery =
  /^(?:show|compare|track|chart|open|look up|find|research|what about)\s+(?:me\s+)?/i;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to use the assistant." }, 401);
  const body = await request.json().catch(() => null);
  const input = prompt.safeParse(body);
  if (!input.success)
    return json({ error: "Enter a request of up to 500 characters." }, 400);
  const { query: text, symbol: selected, dashboard } = input.data;
  let query = text;
  let since: string | undefined;
  const reply = (response: AssistantResult) =>
    json(
      response.view === "markets" && since ? { ...response, since } : response,
    );
  if (input.data.web) {
    if (user.demo || !aiResearchEnabled())
      return json(
        { error: "Web research is unavailable for this session." },
        503,
      );
    try {
      return reply(await aiResearch(query, selected, request.signal));
    } catch {
      return json(
        {
          error:
            "Web research could not complete. Try a shorter question or use the dashboard lookup.",
        },
        502,
      );
    }
  }
  const date = query.match(/\bsince\s+(.+)$/i);
  if (date) {
    since = parseStart(date[1]);
    if (!since)
      return reply({
        answer:
          "Enter a date such as “1 January” or “2025-01-01”. Choose a date in the past 20 years.",
      });
    query = query.slice(0, date.index).trim();
    if (
      !query ||
      /^(?:(?:now )?show )?(?:it|this|the chart|the dashboard)$/i.test(query)
    ) {
      if (dashboard?.view !== "markets")
        return reply({
          answer: "Open a market view first, then ask for a start date.",
        });
      return reply({
        ...dashboard,
        since,
        answer: `Updated price history from ${since}. The market map now shows changes over that period.`,
      });
    }
  }
  const edit = await editDashboard(query, dashboard);
  if (edit) return reply(edit);
  if (/^(?:(?:show|open|chart)(?: me)?\s+(?:the\s+)?)?dax$/i.test(query)) {
    return reply({
      view: "markets",
      ticker: "^GDAXI",
      symbols: ["^GDAXI"],
      answer: "Opened the DAX index.",
    });
  }
  const lower = query.toLowerCase();
  const manager =
    Object.entries(managers).find(([name]) =>
      lower.includes(name.toLowerCase()),
    ) ??
    (/buffett|berkshire/i.test(query)
      ? ["Berkshire Hathaway", "1067983"]
      : undefined);
  const cik = query.match(/\bCIK\s*(\d{1,10})\b/i)?.[1];
  if (manager || cik)
    return reply({
      view: "research",
      researchTab: "filings",
      cik: manager?.[1] ?? cik,
      answer: `Open the latest 13F for ${manager?.[0] ?? `SEC filer ${cik}`}. The table shows the holdings as of the report date.`,
    });
  if (/wallstreetbets|reddit|\bwsb\b/i.test(query))
    return reply({
      view: "research",
      researchTab: "social",
      answer:
        "Opened the top WallStreetBets tickers by 24-hour mentions. The table includes the previous 24-hour count.",
    });
  if (/\bmy (?:portfolio|positions|holdings|trades)\b/i.test(query)) {
    const workspace = (await readWorkspace(user.id)).data;
    return reply({
      view: "portfolio",
      answer: workspace.trades.length
        ? `Opened your portfolio ledger with ${workspace.trades.length} recorded transactions across ${workspace.books.length} portfolios.`
        : "Opened your portfolio ledger. Add a transaction or import a CSV to begin tracking positions.",
    });
  }
  const priceAlert = query.match(
    /\balert\s+(?:me\s+)?(?:when|if|for)\s+(\S+)\s+(?:goes\s+|is\s+|reaches\s+)?(above|below)\s+[$€£]?(\d+(?:\.\d+)?)/i,
  );
  if (priceAlert && symbolPattern.test(priceAlert[1].toUpperCase())) {
    const symbol = priceAlert[1].toUpperCase();
    const direction =
      priceAlert[2].toLowerCase() === "below" ? "below" : "above";
    const target = Number(priceAlert[3]);
    if (target > 0 && target <= 1e12)
      return reply({
        view: "alerts",
        alert: { symbol, direction, target },
        answer: `Ready to review an alert for ${symbol} at or ${direction} ${amount(target)} in its quote currency.`,
      });
  }
  if (/\b(?:my |set |create )?(?:price )?alerts?\b/i.test(query))
    return reply({
      view: "alerts",
      answer:
        "Opened price alerts. Use New alert to choose a ticker, price threshold, and direction.",
    });
  if (/\bmy watchlist\b/i.test(query))
    return reply({ view: "watchlists", answer: "Opened your watchlists." });
  if (/\bmy (?:notes|journal)\b/i.test(query))
    return reply({
      view: "research",
      researchTab: "journal",
      answer: "Opened your research journal.",
    });
  for (const [match, universe] of presets) {
    if (match.test(query) && !/\b(news|filings)\b/i.test(query)) {
      return reply({
        view: "markets",
        universe,
        ticker: universe === "S&P 500" ? "^GSPC" : universes[universe][0],
        answer: `Opened the ${universe} market map. Select a company to view its price history and research.`,
      });
    }
  }
  const candidates = [
    ...new Set(
      query
        .match(/\$?[A-Z^][A-Z0-9.^=-]{0,19}\b/g)
        ?.map((item) => item.replace(/^\$/, "")) ?? [],
    ),
  ]
    .filter((item) => symbolPattern.test(item) && !ignore.has(item))
    .slice(0, 12);
  try {
    const explicitResearch =
      /news|fundamentals|financials|earnings|filing|research|why|what happened/i.test(
        query,
      );
    const context =
      /^(?:latest\s+)?(?:news|filings|fundamentals|earnings)(?:\s+please)?[?.]?$/i.test(
        query,
      ) || /\b(this|it|selected|the stock)\b/i.test(query);
    const company = query
      .replace(setQuery, "")
      .replace(
        /^(?:latest\s+)?(?:news|fundamentals|financials|earnings|filings)(?:\s+(?:for|on|about))?\s+/i,
        "",
      )
      .replace(/[?.!]+$/, "")
      .trim();
    let symbols = (await quotes(candidates)).map((item) => item.symbol);
    if (!symbols.length && selected && context) symbols = [selected];
    if (
      !symbols.length &&
      company.length <= 80 &&
      (explicitResearch ||
        setQuery.test(query) ||
        /^[\w .&-]{1,30}$/.test(query))
    ) {
      const result = await search(company);
      const match = result.instruments[0]?.symbol;
      if (match) symbols = [match];
    }
    if (symbols.length && explicitResearch) {
      const focus = symbols[0];
      const [news, sec] = await Promise.all([
        search(focus)
          .then((item) => item.news)
          .catch(() => []),
        companyResearch(focus).catch(() => null),
      ]);
      const sourceLinks =
        /filings|fundamentals|financials|earnings/i.test(query) &&
        sec?.filings.length
          ? sec.filings.slice(0, 3).map((filing) => ({
              title: `${filing.form} filed ${filing.filed}`,
              url: filing.url,
            }))
          : news.slice(0, 4);
      const headline = news[0]?.title;
      const financials = sec?.facts
        .slice(0, 3)
        .map(
          (fact) =>
            `${fact.label} ${amount(fact.value)} ${fact.unit} for the period ending ${fact.period}`,
        )
        .join(". ");
      return reply({
        view: "research",
        researchTab: "company",
        symbols,
        answer: `Opened research for ${focus}.${financials && /fundamentals|financials|earnings/i.test(query) ? ` Latest annual SEC figures: ${financials}.` : headline ? ` Recent coverage includes “${headline}”.` : ""}`,
        sources: sourceLinks,
      });
    }
    if (symbols.length) {
      const snapshot = await quotes(symbols);
      const summary = snapshot
        .map(
          (item) =>
            `${item.symbol} ${amount(item.price)} ${item.currency} (${percent(item.percent)})`,
        )
        .join(" · ");
      return reply({
        view: "markets",
        ticker: symbols[0],
        symbols,
        answer: summary
          ? `Latest regular-session quotes: ${summary}.`
          : `Opened market data for ${symbols.join(", ")}.`,
      });
    }
  } catch {
    return json(
      {
        error:
          "Market or research data is temporarily unavailable. Try again in a moment.",
      },
      502,
    );
  }
  return reply({
    answer: `Try a market, company, or saved workspace. For example, “Show European markets”, “Compare NVDA and AMD”, “News for Apple”, “Show Buffett’s holdings”, or “Open my portfolio”. Available maps include ${Object.keys(universes).join(", ")}.`,
  });
}
