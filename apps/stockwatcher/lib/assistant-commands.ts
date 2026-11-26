import "server-only";
import {
  type AssistantResult,
  type DashboardState,
  supportedStartDate,
} from "./assistant-types";
import { members, search } from "./market";
import { benchmarks, symbolPattern, universes } from "./universes";

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const aliases: Record<string, string> = {
  tesla: "TSLA",
  apple: "AAPL",
  nvidia: "NVDA",
  microsoft: "MSFT",
  amazon: "AMZN",
  alphabet: "GOOGL",
  google: "GOOGL",
  meta: "META",
  facebook: "META",
  dax: "^GDAXI",
  sberbank: "SBER.ME",
  gazprom: "GAZP.ME",
};

export function parseStart(raw: string, now = new Date()): string | undefined {
  const input = raw
    .trim()
    .toLowerCase()
    .replace(/[?.!]$/, "");
  if (supportedStartDate(input, now)) return input;
  const pattern =
    /^(?:(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)|([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?)(?:[,\s]+(\d{4}))?$/;
  const match = input.match(pattern);
  if (!match) return undefined;
  const day = (match[1] ?? match[4]).padStart(2, "0");
  const month = monthNames.findIndex(
    (name) =>
      name === (match[2] ?? match[3]) ||
      name.slice(0, 3) === (match[2] ?? match[3]),
  );
  if (month < 0) return undefined;
  const monthDay = `${String(month + 1).padStart(2, "0")}-${day}`;
  let year = match[5] ? Number(match[5]) : now.getUTCFullYear();
  if (!match[5] && monthDay > now.toISOString().slice(5, 10)) year--;
  const date = `${year}-${monthDay}`;
  return supportedStartDate(date, now) ? date : undefined;
}

async function resolveList(query: string, known: Set<string>) {
  const key = query
    .toLowerCase()
    .trim()
    .replace(/^the\s+/i, "")
    .replace(/[?.!]$/, "");
  if (/^(?:banks|bank stocks|banking stocks)$/.test(key))
    return [...universes.Banks];
  const terms = key
    .split(/\s*(?:,|\band\b)\s*/)
    .filter(Boolean)
    .slice(0, 12);
  const results = await Promise.all(
    terms.map(async (term) => {
      if (aliases[term]) return aliases[term];
      const exact = term.toUpperCase();
      if (known.has(exact) || Object.hasOwn(benchmarks, exact)) return exact;
      const result = await search(term).catch(() => null);
      const instruments = result?.instruments ?? [];
      return (
        instruments.find((item) => item.symbol === exact)?.symbol ??
        instruments.find((item) => item.name.toLowerCase() === term)?.symbol ??
        instruments[0]?.symbol
      );
    }),
  );
  return [
    ...new Set(
      results.filter(
        (item): item is string =>
          typeof item === "string" && symbolPattern.test(item),
      ),
    ),
  ];
}

export async function editDashboard(
  query: string,
  state?: DashboardState,
): Promise<AssistantResult | undefined> {
  const action = query.match(
    /^(?:and\s+)?(?:now\s+)?(?:please\s+)?(add|include|remove|exclude|drop)\s+(.+)$/i,
  );
  if (!action) return undefined;
  if (state?.view !== "markets") {
    return {
      answer:
        "Open a market view first, then tell me which companies or group to add or remove.",
    };
  }
  const base = state.universe
    ? members(state.universe).map((item) => item.symbol)
    : [];
  const additions = new Set(state.symbols ?? []);
  const excluded = new Set(state.excluded ?? []);
  const visible = new Set(
    [...base, ...additions].filter((symbol) => !excluded.has(symbol)),
  );
  const wanted = await resolveList(action[2], new Set([...base, ...additions]));
  if (!wanted.length)
    return {
      answer:
        "I couldn’t match those companies. Try a ticker or a group like “banks”.",
    };
  const removing = /^(remove|exclude|drop)$/i.test(action[1]);
  const changed: string[] = [];
  for (const symbol of wanted) {
    if (removing && visible.has(symbol)) {
      additions.delete(symbol);
      if (base.includes(symbol)) excluded.add(symbol);
      visible.delete(symbol);
      changed.push(symbol);
    } else if (!removing && !visible.has(symbol)) {
      excluded.delete(symbol);
      if (!base.includes(symbol)) additions.add(symbol);
      visible.add(symbol);
      changed.push(symbol);
    }
  }
  if (!changed.length) {
    return {
      answer: removing
        ? "Those symbols aren’t on the current dashboard."
        : "Those symbols are already on the current dashboard.",
    };
  }
  if (additions.size > 120 || excluded.size > 120) {
    return {
      answer:
        "This dashboard supports up to 120 manual additions or removals. Start a new view to change a larger set.",
    };
  }
  return {
    ...state,
    symbols: [...additions],
    excluded: [...excluded],
    ticker:
      state.ticker && !changed.includes(state.ticker)
        ? state.ticker
        : [...visible][0],
    answer: `${removing ? "Removed" : "Added"} ${changed.join(", ")}. The dashboard now shows ${visible.size} ${visible.size === 1 ? "symbol" : "symbols"}.`,
  };
}
