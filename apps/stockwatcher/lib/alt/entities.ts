import "server-only";
import { allTickers, lookupCik } from "../sec-data";

/**
 * Turns the names government records use (a contractor, a lobbying client, a
 * PAC's connected organisation, a patent assignee, a WARN employer) into SEC
 * tickers, and a ticker into the names to search those records for.
 *
 * Matching is on a normalised name: case, punctuation, corporate suffixes and
 * a leading "the" removed. An exact normalised match wins; otherwise the
 * longest registrant name that is a whole-word prefix of the query (so
 * "LOCKHEED MARTIN AERONAUTICS CO" resolves to Lockheed Martin) is taken when
 * it covers most of the query's distinctive words. Overrides catch the names
 * no rule can (brands, renamed companies, holding structures).
 */

const suffixes = new Set([
  "INC",
  "INCORPORATED",
  "CORP",
  "CORPORATION",
  "CO",
  "COMPANY",
  "COS",
  "LTD",
  "LIMITED",
  "LLC",
  "LP",
  "LLP",
  "PLC",
  "NV",
  "SA",
  "AG",
  "SE",
  "HOLDINGS",
  "HOLDING",
  "GROUP",
  "THE",
  "DE",
  "DEL",
  "NEW",
  "CL",
  "CLASS",
  "A",
  "TRUST",
  "INTERNATIONAL",
  "INTL",
  "USA",
  "US",
  "AMERICA",
  "NORTH",
  "OF",
  "AND",
]);

/** Distinctive words: what remains of a name after suffixes and filler. */
export function nameWords(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\/[A-Z]{2}\/?$/, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function normaliseName(name: string): string {
  const words = nameWords(name);
  while (words.length > 1 && suffixes.has(words.at(-1)!)) words.pop();
  if (words[0] === "THE" && words.length > 1) words.shift();
  return words.join(" ");
}

/** Names no normalisation can reach; keyed by normalised name. */
const overrides: Record<string, string> = {
  GOOGLE: "GOOGL",
  ALPHABET: "GOOGL",
  FACEBOOK: "META",
  "META PLATFORMS": "META",
  "AMAZON COM": "AMZN",
  "AMAZON WEB SERVICES": "AMZN",
  AMAZON: "AMZN",
  RAYTHEON: "RTX",
  "RAYTHEON TECHNOLOGIES": "RTX",
  "UNITED TECHNOLOGIES": "RTX",
  "GENERAL DYNAMICS": "GD",
  "ELECTRIC BOAT": "GD",
  "GULFSTREAM AEROSPACE": "GD",
  "BATH IRON WORKS": "GD",
  "SIKORSKY AIRCRAFT": "LMT",
  "HUNTINGTON INGALLS": "HII",
  "NORTHROP GRUMMAN SYSTEMS": "NOC",
  BOEING: "BA",
  "MCDONNELL DOUGLAS": "BA",
  MICROSOFT: "MSFT",
  APPLE: "AAPL",
  "BERKSHIRE HATHAWAY": "BRK-B",
  "JPMORGAN CHASE": "JPM",
  "JP MORGAN CHASE": "JPM",
  WALMART: "WMT",
  "WAL MART STORES": "WMT",
  PFIZER: "PFE",
  MODERNA: "MRNA",
  MODERNATX: "MRNA",
  "INTERNATIONAL BUSINESS MACHINES": "IBM",
  IBM: "IBM",
  LEIDOS: "LDOS",
  "BOOZ ALLEN HAMILTON": "BAH",
  "SCIENCE APPLICATIONS": "SAIC",
  "L3HARRIS TECHNOLOGIES": "LHX",
  HARRIS: "LHX",
  "PALANTIR TECHNOLOGIES": "PLTR",
  "SPACE EXPLORATION TECHNOLOGIES": "",
  MCKESSON: "MCK",
  HUMANA: "HUM",
  CENTENE: "CNC",
  UNITEDHEALTH: "UNH",
  "UNITED HEALTHCARE": "UNH",
  OPTUM: "UNH",
  "CVS HEALTH": "CVS",
  AETNA: "CVS",
  COMCAST: "CMCSA",
  NBCUNIVERSAL: "CMCSA",
  "NBCUNIVERSAL MEDIA": "CMCSA",
  "AMERICAN NATIONAL RED CROSS": "",
  "BANNER HEALTH": "",
};

type Registrant = {
  ticker: string;
  cik: string;
  name: string;
  key: string;
  order: number;
};

type Index = {
  at: number;
  byKey: Map<string, Registrant>;
  byCik: Map<string, Registrant[]>;
};
let index: Index | null = null;
let building: Promise<Index> | null = null;

/**
 * Share classes and preferreds share a CIK. SEC lists a registrant's primary
 * ticker first, so file order wins, except that a preferred or unit series
 * (`-P…`, `-U…`, `-W…`) never stands for the company.
 */
const rank = (row: Registrant) =>
  (/-[PUW]/.test(row.ticker) ? 1_000_000 : 0) + row.order;

/**
 * Words that may trail a registrant's name in a subsidiary or division name
 * without changing who it is: "LOCKHEED MARTIN AERONAUTICS" is Lockheed.
 */
const divisionWords = new Set([
  "AERONAUTICS",
  "AEROSPACE",
  "AIRCRAFT",
  "DEFENSE",
  "DEFENCE",
  "SPACE",
  "MISSILES",
  "FIRE",
  "CONTROL",
  "MISSION",
  "SYSTEMS",
  "SERVICES",
  "SOLUTIONS",
  "TECHNOLOGIES",
  "TECHNOLOGY",
  "FEDERAL",
  "GOVERNMENT",
  "ENTERPRISES",
  "INDUSTRIES",
  "OPERATIONS",
  "MANUFACTURING",
  "SALES",
  "PRODUCTS",
  "LOGISTICS",
  "ROTARY",
  "WING",
  "INFORMATION",
  "GLOBAL",
  "WORLDWIDE",
  "ENGINEERING",
  "SECTOR",
  "DIVISION",
  "SUBSIDIARY",
  "PAC",
  "POLITICAL",
  "ACTION",
  "COMMITTEE",
  "EMPLOYEES",
  "FUND",
]);

async function registrants(): Promise<Index> {
  if (index && Date.now() - index.at < 86_400_000) return index;
  building ??= (async (): Promise<Index> => {
    const rows = await allTickers();
    const byCik = new Map<string, Registrant[]>();
    rows.forEach((row, order) => {
      const entry = { ...row, key: normaliseName(row.name), order };
      const list = byCik.get(row.cik) ?? [];
      list.push(entry);
      byCik.set(row.cik, list);
    });
    const byKey = new Map<string, Registrant>();
    for (const list of byCik.values()) {
      list.sort((a, b) => rank(a) - rank(b));
      const primary = list[0];
      const held = byKey.get(primary.key);
      if (!held || rank(primary) < rank(held)) byKey.set(primary.key, primary);
    }
    const built: Index = { at: Date.now(), byKey, byCik };
    index = built;
    return built;
  })().finally(() => {
    building = null;
  });
  return building;
}

export type Resolved = {
  ticker: string;
  cik: string;
  name: string;
  /** exact: same normalised name; override: curated; prefix: registrant name plus division words. */
  match: "exact" | "override" | "prefix";
};

const memo = new Map<string, Resolved | null>();

async function fromOverride(ticker: string): Promise<Resolved | null> {
  if (!ticker) return null;
  const hit = await lookupCik(ticker);
  return hit
    ? { ticker, cik: hit.cik, name: hit.name, match: "override" }
    : null;
}

/**
 * The SEC registrant a free-text organisation name refers to, or null.
 * Tries the whole normalised name, then ever shorter leading prefixes, and
 * accepts a prefix only when every word it drops is a division word, so
 * "AMERICAN NATIONAL RED CROSS" never becomes American National Group.
 */
export async function resolveName(raw: string): Promise<Resolved | null> {
  const key = normaliseName(raw);
  if (!key) return null;
  if (memo.has(key)) return memo.get(key) ?? null;
  const { byKey } = await registrants();
  const words = key.split(" ");
  let result: Resolved | null = null;
  for (let length = words.length; length >= 1; length--) {
    const dropped = words.slice(length);
    if (!dropped.every((word) => divisionWords.has(word))) break;
    const prefix = normaliseName(words.slice(0, length).join(" "));
    if (prefix.length < 3) break;
    const override = overrides[prefix];
    if (override !== undefined) {
      result = await fromOverride(override);
      break;
    }
    const hit = byKey.get(prefix);
    if (hit) {
      result = {
        ...pick(hit),
        match: length === words.length ? "exact" : "prefix",
      };
      break;
    }
  }
  if (memo.size > 50_000) memo.clear();
  memo.set(key, result);
  return result;
}

const pick = (row: Registrant) => ({
  ticker: row.ticker,
  cik: row.cik,
  name: row.name,
});

/** Resolve many names at once; the result is keyed by the raw name. */
export async function resolveNames(
  names: readonly string[],
): Promise<Map<string, Resolved | null>> {
  const out = new Map<string, Resolved | null>();
  for (const name of new Set(names)) out.set(name, await resolveName(name));
  return out;
}

export type CompanyNames = {
  ticker: string;
  cik: string;
  /** SEC conformed name, e.g. "LOCKHEED MARTIN CORP". */
  name: string;
  /** Normalised name, e.g. "LOCKHEED MARTIN": the best search term. */
  search: string;
  /** Every override alias that points at this ticker, normalised. */
  aliases: string[];
};

/** The names to look a company up by in government records. */
export async function namesFor(ticker: string): Promise<CompanyNames | null> {
  const symbol = ticker.toUpperCase();
  const hit = await lookupCik(symbol);
  if (!hit) return null;
  const search = normaliseName(hit.name);
  const aliases = Object.entries(overrides)
    .filter(([alias, target]) => target === symbol && alias !== search)
    .map(([alias]) => alias);
  return { ticker: symbol, cik: hit.cik, name: hit.name, search, aliases };
}

/** True when a free-text organisation name refers to the given ticker. */
export async function nameMatches(raw: string, ticker: string) {
  return (await resolveName(raw))?.ticker === ticker.toUpperCase();
}
