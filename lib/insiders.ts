import "server-only";
import { XMLParser } from "fast-xml-parser";
import { mapLimit } from "./pool";
import { sec } from "./research";

const PARSE_CONCURRENCY = 6;
const CIK_CHUNK = 250;
const PAGE_SIZE = 100;
const MAX_OFFSET = 10_000;
const MAX_CANDIDATES = 3_000;
const FORM_CACHE_LIMIT = 30_000;

export const DEFAULT_BUDGET_MS = 40_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function edgar<T>(host: string, path: string, ttl: number): Promise<T> {
  try {
    return await sec<T>(host, path, ttl);
  } catch (error) {
    if (!(error instanceof Error) || !/HTTP (429|503)/.test(error.message))
      throw error;
    await sleep(1_500);
    return sec<T>(host, path, ttl);
  }
}

const parser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: false,
  isArray: (name) =>
    name === "nonDerivativeTransaction" ||
    name === "reportingOwner" ||
    name === "reportingPersonInfo",
});

const decode = (text: string) =>
  text
    .replaceAll("&amp;", "&")
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ")
    .trim();

type Node = { [key: string]: Node | Node[] | string | undefined };
const isNode = (value: Node | Node[] | string | undefined): value is Node =>
  typeof value === "object" && !Array.isArray(value);

/** Every text value stored under a tag name, wherever it sits in the document. */
function collect(node: Node | Node[] | string | undefined, tag: string, out: string[] = []) {
  if (node == null || typeof node === "string") return out;
  if (Array.isArray(node)) {
    for (const item of node) collect(item, tag, out);
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.toLowerCase() === tag.toLowerCase()) {
      if (typeof value === "string") out.push(value);
      else if (isNode(value) && typeof value["#text"] === "string")
        out.push(value["#text"]);
    } else collect(value, tag, out);
  }
  return out;
}

const text = (node: Node | undefined, key: string) => {
  const value = node?.[key];
  if (typeof value === "string") return value;
  if (isNode(value)) {
    const inner = value.value;
    return typeof inner === "string" ? inner : undefined;
  }
  return undefined;
};

const archivePath = (cik: string, accession: string, file: string) =>
  `/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/${file}`;
export const filingIndexUrl = (cik: string, accession: string) =>
  `https://www.sec.gov${archivePath(cik, accession, `${accession}-index.htm`)}`;

const cikKey = (cik: string) => cik.replace(/^0+/, "");

type Hit = {
  accession: string;
  file: string;
  ciks: string[];
  names: string[];
  form: string;
  filed: string;
};
type SearchResponse = {
  hits: {
    total: { value: number };
    hits: Array<{
      _id: string;
      _source: {
        ciks?: string[];
        display_names?: string[];
        form?: string;
        file_date?: string;
      };
    }>;
  };
};

type Deadline = { at: number };
const expired = (deadline: Deadline) => Date.now() >= deadline.at;

async function search(
  forms: string,
  q: string | null,
  from: string,
  to: string,
  ciks: string[] | null,
  deadline: Deadline,
  cap: number,
) {
  const hits = new Map<string, Hit>();
  let truncated = false;
  const chunks = ciks
    ? Array.from({ length: Math.ceil(ciks.length / CIK_CHUNK) }, (_, i) =>
        ciks.slice(i * CIK_CHUNK, (i + 1) * CIK_CHUNK),
      )
    : [null];
  for (const chunk of chunks) {
    for (let offset = 0; offset < MAX_OFFSET; offset += PAGE_SIZE) {
      if (expired(deadline) || hits.size >= cap) {
        truncated = true;
        break;
      }
      const params = new URLSearchParams({
        forms,
        dateRange: "custom",
        startdt: from,
        enddt: to,
        from: String(offset),
      });
      if (q) params.set("q", q);
      if (chunk) params.set("ciks", chunk.join(","));
      const page = await edgar<SearchResponse>(
        "efts.sec.gov",
        `/LATEST/search-index?${params}`,
        600,
      );
      for (const hit of page.hits.hits) {
        const [accession, file] = hit._id.split(":");
        if (!accession || !file || hits.has(accession)) continue;
        hits.set(accession, {
          accession,
          file,
          ciks: hit._source.ciks ?? [],
          names: (hit._source.display_names ?? []).map(decode),
          form: hit._source.form ?? forms,
          filed: hit._source.file_date ?? "",
        });
      }
      if (offset + PAGE_SIZE >= page.hits.total.value) break;
      if (offset + PAGE_SIZE >= MAX_OFFSET) truncated = true;
    }
  }
  return {
    hits: [...hits.values()].sort((a, b) => b.filed.localeCompare(a.filed)),
    truncated,
  };
}

type TickerEntry = { ticker: string; cik_str: number; title: string };
let tickerIndex: Promise<{
  bySymbol: Map<string, string>;
  byCik: Map<string, string>;
}> | null = null;

function tickers() {
  tickerIndex ??= edgar<Record<string, TickerEntry>>(
    "www.sec.gov",
    "/files/company_tickers.json",
    86_400,
  )
    .then((all) => {
      const bySymbol = new Map<string, string>();
      const byCik = new Map<string, string>();
      for (const entry of Object.values(all)) {
        const cik = String(entry.cik_str).padStart(10, "0");
        bySymbol.set(entry.ticker.toUpperCase(), cik);
        if (!byCik.has(cik)) byCik.set(cik, entry.ticker.toUpperCase());
      }
      return { bySymbol, byCik };
    })
    .catch((error: unknown) => {
      tickerIndex = null;
      throw error;
    });
  return tickerIndex;
}

async function resolveUniverse(symbols: string[]) {
  const { bySymbol } = await tickers();
  const ciks = new Map<string, string>();
  const unresolved: string[] = [];
  for (const symbol of symbols) {
    const upper = symbol.toUpperCase();
    const cik =
      bySymbol.get(upper) ??
      bySymbol.get(upper.replace("-", ".")) ??
      bySymbol.get(upper.replace(".", "-"));
    if (cik) ciks.set(cik, upper);
    else unresolved.push(symbol);
  }
  return { ciks, unresolved };
}

const dateDaysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const toNumber = (value: string | undefined) => {
  if (value == null) return null;
  const parsed = Number(value.replace(/[%,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

type Purchase = {
  date: string;
  shares: number;
  price: number | null;
  indirect: boolean;
};
type ParsedForm4 = {
  issuerCik: string;
  issuerName: string;
  symbol: string | null;
  insider: { key: string; name: string; role: string };
  purchases: Purchase[];
};
const form4Cache = new Map<string, ParsedForm4 | null>();

function roleOf(owner: Node | undefined) {
  const relation = owner?.reportingOwnerRelationship;
  if (!isNode(relation)) return "Insider";
  const flag = (key: string) => text(relation, key) === "1" || text(relation, key) === "true";
  const title = text(relation, "officerTitle");
  const parts = [
    flag("isOfficer") ? (title ? decode(title) : "Officer") : null,
    flag("isDirector") ? "Director" : null,
    flag("isTenPercentOwner") ? "10% owner" : null,
  ].filter((part): part is string => part != null);
  return parts.join(", ") || "Insider";
}

function parseForm4(xml: string): ParsedForm4 | null {
  const document = parser.parse(xml) as { ownershipDocument?: Node };
  const root = document.ownershipDocument;
  if (!root) return null;
  const issuer = isNode(root.issuer) ? root.issuer : undefined;
  const owners = Array.isArray(root.reportingOwner) ? root.reportingOwner : [];
  const first = owners[0];
  const id = isNode(first?.reportingOwnerId) ? first.reportingOwnerId : undefined;
  const table = isNode(root.nonDerivativeTable) ? root.nonDerivativeTable : undefined;
  const rows = Array.isArray(table?.nonDerivativeTransaction)
    ? table.nonDerivativeTransaction
    : [];
  const purchases = rows.flatMap((row): Purchase[] => {
    const coding = isNode(row.transactionCoding) ? row.transactionCoding : undefined;
    if (text(coding, "transactionCode") !== "P") return [];
    const amounts = isNode(row.transactionAmounts) ? row.transactionAmounts : undefined;
    const shares = toNumber(text(amounts, "transactionShares"));
    const date = text(row, "transactionDate");
    if (!shares || shares <= 0 || !date) return [];
    const price = toNumber(text(amounts, "transactionPricePerShare"));
    const ownership = isNode(row.ownershipNature) ? row.ownershipNature : undefined;
    return [
      {
        date,
        shares,
        price: price && price > 0 ? price : null,
        indirect: text(ownership, "directOrIndirectOwnership") === "I",
      },
    ];
  });
  const issuerCik = text(issuer, "issuerCik");
  if (!issuerCik) return null;
  const name = decode(text(id, "rptOwnerName") ?? "Unknown");
  return {
    issuerCik,
    issuerName: decode(text(issuer, "issuerName") ?? ""),
    symbol: text(issuer, "issuerTradingSymbol")?.trim().toUpperCase() || null,
    insider: {
      key: text(id, "rptOwnerCik") ?? name,
      name: owners.length > 1 ? `${name} +${owners.length - 1}` : name,
      role: roleOf(first),
    },
    purchases,
  };
}

async function fetchForm4(hit: Hit) {
  if (form4Cache.has(hit.accession)) return form4Cache.get(hit.accession) ?? null;
  const cik = hit.ciks.at(-1) ?? hit.ciks[0];
  const xml = await edgar<string>(
    "www.sec.gov",
    archivePath(cik, hit.accession, hit.file),
    86_400,
  );
  const parsed = parseForm4(xml);
  if (form4Cache.size >= FORM_CACHE_LIMIT) form4Cache.clear();
  form4Cache.set(hit.accession, parsed);
  return parsed;
}

export type BuyerSummary = {
  name: string;
  role: string;
  shares: number;
  value: number;
  averagePrice: number | null;
  lastDate: string;
};
export type PurchaseRow = {
  symbol: string | null;
  issuer: string;
  insider: string;
  role: string;
  date: string;
  filed: string;
  shares: number;
  price: number | null;
  value: number;
  indirect: boolean;
  url: string;
};
export type Cluster = {
  symbol: string | null;
  issuer: string;
  insiders: number;
  purchases: number;
  totalValue: number;
  averagePrice: number | null;
  firstDate: string;
  lastDate: string;
  buyers: BuyerSummary[];
  url: string;
};

const dayNumber = (iso: string) => Math.floor(Date.parse(iso) / 86_400_000);

/** Best window per issuer: the one with the most distinct buyers, ties broken by dollar value. */
function bestCluster(rows: PurchaseRow[], keys: string[], windowDays: number) {
  const ordered = rows
    .map((row, index) => ({ row, key: keys[index], day: dayNumber(row.date) }))
    .sort((a, b) => a.day - b.day);
  let best: typeof ordered = [];
  let bestScore: [number, number] = [0, 0];
  for (let i = 0; i < ordered.length; i++) {
    const window = ordered.filter(
      (item) => item.day >= ordered[i].day && item.day <= ordered[i].day + windowDays,
    );
    const insiders = new Set(window.map((item) => item.key)).size;
    const value = window.reduce((sum, item) => sum + item.row.value, 0);
    if (insiders > bestScore[0] || (insiders === bestScore[0] && value > bestScore[1])) {
      best = window;
      bestScore = [insiders, value];
    }
  }
  return best;
}

export type InsiderScreen = {
  from: string;
  to: string;
  windowDays: number;
  minInsiders: number;
  universeSize: number | null;
  unresolvedSymbols: string[];
  candidateFilings: number;
  parsedFilings: number;
  purchaseCount: number;
  totalValue: number;
  clusters: Cluster[];
  largestPurchases: PurchaseRow[];
  partial: string | null;
};

export async function insiderBuying(options: {
  symbols: string[] | null;
  days: number;
  windowDays: number;
  minInsiders: number;
  minValue: number;
  budgetMs?: number;
}): Promise<InsiderScreen> {
  const deadline = { at: Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS) };
  const from = dateDaysAgo(options.days);
  const to = dateDaysAgo(0);
  const universe = options.symbols ? await resolveUniverse(options.symbols) : null;
  if (universe && !universe.ciks.size)
    throw new Error(
      "None of those symbols map to SEC registrants (US-listed issuers only).",
    );
  const found = await search(
    "4",
    "P",
    from,
    to,
    universe ? [...universe.ciks.keys()] : null,
    deadline,
    MAX_CANDIDATES,
  );
  const reasons: string[] = [];
  if (found.truncated)
    reasons.push(
      "The filing search was cut short, so older filings may be missing.",
    );
  let parsedCount = 0;
  let failed = 0;
  const parsed = await mapLimit(found.hits, PARSE_CONCURRENCY, async (hit) => {
    if (expired(deadline) && !form4Cache.has(hit.accession)) return null;
    try {
      const result = await fetchForm4(hit);
      parsedCount++;
      return result ? { hit, result } : null;
    } catch {
      failed++;
      return null;
    }
  });
  const skipped = found.hits.length - parsedCount - failed;
  if (skipped > 0)
    reasons.push(
      `Time budget reached: parsed ${parsedCount} of ${found.hits.length} candidate filings (newest first), so counts are lower bounds.`,
    );
  if (failed > 0)
    reasons.push(`${failed} filings could not be read from EDGAR.`);
  const keys: string[] = [];
  const byIssuer = new Map<string, PurchaseRow[]>();
  const all: PurchaseRow[] = [];
  const universeCiks = universe ? new Set([...universe.ciks.keys()].map(cikKey)) : null;
  for (const item of parsed) {
    if (!item) continue;
    const { hit, result } = item;
    if (universeCiks && !universeCiks.has(cikKey(result.issuerCik))) continue;
    for (const purchase of result.purchases) {
      const value = purchase.price ? purchase.price * purchase.shares : 0;
      if (value < options.minValue) continue;
      const row: PurchaseRow = {
        symbol: result.symbol,
        issuer: result.issuerName,
        insider: result.insider.name,
        role: result.insider.role,
        date: purchase.date,
        filed: hit.filed,
        shares: purchase.shares,
        price: purchase.price,
        value,
        indirect: purchase.indirect,
        url: filingIndexUrl(result.issuerCik, hit.accession),
      };
      const list = byIssuer.get(result.issuerCik) ?? [];
      list.push(row);
      byIssuer.set(result.issuerCik, list);
      all.push(row);
      keys.push(result.insider.key);
    }
  }
  const keyOf = new Map(all.map((row, index) => [row, keys[index]]));
  const clusters: Cluster[] = [];
  for (const rows of byIssuer.values()) {
    const window = bestCluster(
      rows,
      rows.map((row) => keyOf.get(row) ?? row.insider),
      options.windowDays,
    );
    const insiderKeys = new Set(window.map((item) => item.key));
    if (insiderKeys.size < options.minInsiders) continue;
    const buyers = new Map<string, BuyerSummary & { cost: number; priced: number }>();
    for (const { row, key } of window) {
      const entry = buyers.get(key) ?? {
        name: row.insider,
        role: row.role,
        shares: 0,
        value: 0,
        averagePrice: null,
        lastDate: row.date,
        cost: 0,
        priced: 0,
      };
      entry.shares += row.shares;
      entry.value += row.value;
      if (row.price) {
        entry.cost += row.value;
        entry.priced += row.shares;
      }
      if (row.date > entry.lastDate) entry.lastDate = row.date;
      buyers.set(key, entry);
    }
    const totalValue = window.reduce((sum, item) => sum + item.row.value, 0);
    const pricedShares = window.reduce(
      (sum, item) => sum + (item.row.price ? item.row.shares : 0),
      0,
    );
    const dates = window.map((item) => item.row.date).sort();
    clusters.push({
      symbol: window[0].row.symbol,
      issuer: window[0].row.issuer,
      insiders: insiderKeys.size,
      purchases: window.length,
      totalValue,
      averagePrice: pricedShares ? totalValue / pricedShares : null,
      firstDate: dates[0],
      lastDate: dates.at(-1)!,
      buyers: [...buyers.values()]
        .map(({ cost, priced, ...buyer }) => ({
          ...buyer,
          averagePrice: priced ? cost / priced : null,
        }))
        .sort((a, b) => b.value - a.value),
      url: window[0].row.url,
    });
  }
  clusters.sort((a, b) => b.insiders - a.insiders || b.totalValue - a.totalValue);
  return {
    from,
    to,
    windowDays: options.windowDays,
    minInsiders: options.minInsiders,
    universeSize: options.symbols ? options.symbols.length : null,
    unresolvedSymbols: universe?.unresolved ?? [],
    candidateFilings: found.hits.length,
    parsedFilings: parsedCount,
    purchaseCount: all.length,
    totalValue: all.reduce((sum, row) => sum + row.value, 0),
    clusters,
    largestPurchases: [...all].sort((a, b) => b.value - a.value).slice(0, 15),
    partial: reasons.length ? reasons.join(" ") : null,
  };
}

export type Stake = {
  filed: string;
  form: string;
  amendment: boolean;
  amendmentNo: string | null;
  filer: string | null;
  otherFilers: number;
  subject: string | null;
  symbol: string | null;
  percentOfClass: number | null;
  sharesOwned: number | null;
  eventDate: string | null;
  url: string;
};

const FORMS_13D = ["SCHEDULE 13D", "SCHEDULE 13D/A", "SC 13D", "SC 13D/A"];
const FORMS_13G = ["SCHEDULE 13G", "SCHEDULE 13G/A", "SC 13G", "SC 13G/A"];
const stakeCache = new Map<string, Stake>();

const namePattern = /\s*\(CIK \d+\)\s*$/;
const tickerPattern = /\s*\(([A-Z0-9.\-, ]+)\)\s*$/;

function fromNames(hit: Hit): Pick<Stake, "filer" | "subject" | "symbol"> {
  const cleaned = hit.names.map((name) => name.replace(namePattern, ""));
  const subjectIndex = cleaned.findIndex((name) => tickerPattern.test(name));
  if (subjectIndex < 0)
    return { filer: cleaned.join("; ") || null, subject: null, symbol: null };
  const subject = cleaned[subjectIndex];
  const symbol = tickerPattern.exec(subject)?.[1].split(",")[0].trim() ?? null;
  return {
    filer:
      cleaned.filter((_, index) => index !== subjectIndex).join("; ") || null,
    subject: subject.replace(tickerPattern, ""),
    symbol,
  };
}

async function fetchStake(hit: Hit): Promise<Stake> {
  const cached = stakeCache.get(hit.accession);
  if (cached) return cached;
  const cik = hit.ciks[0];
  const xml = await edgar<string>(
    "www.sec.gov",
    archivePath(cik, hit.accession, hit.file),
    86_400,
  );
  const tree = parser.parse(xml) as Node;
  const percents = [
    ...collect(tree, "percentOfClass"),
    ...collect(tree, "classPercent"),
  ]
    .map(toNumber)
    .filter((value): value is number => value != null);
  const sharesOwned = [
    ...collect(tree, "aggregateAmountOwned"),
    ...collect(tree, "reportingPersonBeneficiallyOwnedAggregateNumberOfShares"),
  ]
    .map(toNumber)
    .filter((value): value is number => value != null);
  const filers = [...new Set(collect(tree, "reportingPersonName").map(decode))];
  const issuerCik = collect(tree, "issuerCik")[0] ?? cik;
  const base = fromNames(hit);
  const { byCik } = await tickers();
  const stake: Stake = {
    filed: hit.filed,
    form: hit.form,
    amendment: hit.form.endsWith("/A"),
    amendmentNo: collect(tree, "amendmentNo")[0] ?? null,
    filer: filers[0] ?? base.filer,
    otherFilers: Math.max(0, filers.length - 1),
    subject: decode(collect(tree, "issuerName")[0] ?? "") || base.subject,
    symbol: byCik.get(issuerCik.padStart(10, "0")) ?? base.symbol,
    percentOfClass: percents.length ? Math.max(...percents) : null,
    sharesOwned: sharesOwned.length ? Math.max(...sharesOwned) : null,
    eventDate:
      collect(tree, "dateOfEvent")[0] ??
      collect(tree, "eventDateRequiresFilingThisStatement")[0] ??
      null,
    url: filingIndexUrl(issuerCik, hit.accession),
  };
  if (stakeCache.size >= FORM_CACHE_LIMIT) stakeCache.clear();
  stakeCache.set(hit.accession, stake);
  return stake;
}

export type StakeScreen = {
  from: string;
  to: string;
  universeSize: number | null;
  unresolvedSymbols: string[];
  totalFilings: number;
  parsedFilings: number;
  stakes: Stake[];
  partial: string | null;
};

export async function activistStakes(options: {
  symbols: string[] | null;
  days: number;
  include13G: boolean;
  minPercent: number;
  budgetMs?: number;
}): Promise<StakeScreen> {
  const deadline = { at: Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS) };
  const from = dateDaysAgo(options.days);
  const to = dateDaysAgo(0);
  const universe = options.symbols ? await resolveUniverse(options.symbols) : null;
  if (universe && !universe.ciks.size)
    throw new Error(
      "None of those symbols map to SEC registrants (US-listed issuers only).",
    );
  const forms = [...FORMS_13D, ...(options.include13G ? FORMS_13G : [])].join(",");
  const found = await search(
    forms,
    null,
    from,
    to,
    universe ? [...universe.ciks.keys()] : null,
    deadline,
    MAX_CANDIDATES,
  );
  const reasons: string[] = [];
  if (found.truncated)
    reasons.push("The filing search was cut short, so older filings may be missing.");
  let parsedCount = 0;
  let failed = 0;
  const stakes = await mapLimit(found.hits, PARSE_CONCURRENCY, async (hit) => {
    const fallback: Stake = {
      filed: hit.filed,
      form: hit.form,
      amendment: hit.form.endsWith("/A"),
      amendmentNo: null,
      ...fromNames(hit),
      otherFilers: 0,
      percentOfClass: null,
      sharesOwned: null,
      eventDate: null,
      url: filingIndexUrl(hit.ciks[0], hit.accession),
    };
    if (expired(deadline) && !stakeCache.has(hit.accession)) return fallback;
    try {
      const stake = await fetchStake(hit);
      parsedCount++;
      return stake;
    } catch {
      failed++;
      return fallback;
    }
  });
  const skipped = found.hits.length - parsedCount - failed;
  if (skipped > 0)
    reasons.push(
      `Time budget reached: read ${parsedCount} of ${found.hits.length} filings in full; the rest list names only (no % of class).`,
    );
  if (failed > 0)
    reasons.push(`${failed} filings could not be read from EDGAR and list names only.`);
  const keep = stakes
    .filter(
      (stake) =>
        stake.percentOfClass == null || stake.percentOfClass >= options.minPercent,
    )
    .sort(
      (a, b) =>
        b.filed.localeCompare(a.filed) ||
        (b.percentOfClass ?? 0) - (a.percentOfClass ?? 0),
    );
  return {
    from,
    to,
    universeSize: options.symbols ? options.symbols.length : null,
    unresolvedSymbols: universe?.unresolved ?? [],
    totalFilings: found.hits.length,
    parsedFilings: parsedCount,
    stakes: keep,
    partial: reasons.length ? reasons.join(" ") : null,
  };
}
