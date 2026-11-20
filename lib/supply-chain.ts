import "server-only";
import { generateText, Output } from "ai";
import { briefModel } from "./ai/config";
import { readExtract, writeExtract } from "./db";
import { archive, sec, secHeaders, submission } from "./research";
import {
  cachedLinks,
  cachedVerification,
  extractionSchema,
  verificationSchema,
  type Candidate,
  type Filing,
  type Link,
  type OwnDisclosure,
  type Verified,
} from "./supply-chain-types";

type TickerRow = { ticker: string; cik: string; title: string };

const suffix =
  /\b(incorporated|inc|corporation|corp|company|co|ltd|limited|plc|holdings?|group|sa|ag|nv|se|lp|llc|the)\b\.?/g;
export const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,'’()/-]/g, " ")
    .replace(suffix, " ")
    .replace(/\s+/g, " ")
    .trim();

async function tickerIndex() {
  const data = await sec<
    Record<string, { ticker: string; cik_str: number; title: string }>
  >("www.sec.gov", "/files/company_tickers.json", 86400);
  const rows: TickerRow[] = Object.values(data).map((item) => ({
    ticker: item.ticker,
    cik: String(item.cik_str),
    title: item.title,
  }));
  const byName = new Map<string, TickerRow>();
  for (const row of rows) {
    const key = normalizeName(row.title);
    if (key && !byName.has(key)) byName.set(key, row);
  }
  return {
    byTicker: new Map(rows.map((row) => [row.ticker, row])),
    byCik: new Map(rows.map((row) => [row.cik, row])),
    byName,
  };
}

function matchTicker(
  name: string,
  index: Awaited<ReturnType<typeof tickerIndex>>,
) {
  const key = normalizeName(name);
  if (!key || /^unnamed/.test(key)) return null;
  return index.byName.get(key)?.ticker ?? null;
}

/** Name to search other filings for: specific enough to avoid noise. */
function searchName(title: string) {
  const short = title
    .replace(/\s+(INC|CORP|CORPORATION|CO|LTD|PLC|HOLDINGS?)\.?$/i, "")
    .trim();
  return short.split(/\s+/).length > 1 ? short : title;
}

async function latestAnnual(cik: string, ticker: string | null) {
  const record = await submission(cik);
  const recent = record.filings.recent;
  const index = recent.form.findIndex((form) =>
    /^(10-K|20-F|40-F)$/.test(form),
  );
  if (index < 0) return null;
  const filing: Filing = {
    cik,
    name: record.name,
    ticker,
    form: recent.form[index],
    filed: recent.filingDate[index],
    accession: recent.accessionNumber[index],
    url: `https://www.sec.gov${archive(cik, recent.accessionNumber[index])}/${recent.primaryDocument[index]}`,
  };
  return filing;
}

const entities: Record<string, string> = {
  amp: "&",
  nbsp: " ",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  mdash: "—",
  ndash: "–",
};

async function filingText(url: string) {
  const response = await fetch(url, {
    headers: secHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`SEC returned HTTP ${response.status}.`);
  return (await response.text())
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => entities[name] ?? match)
    .replace(/\s+/g, " ");
}

function excerpts(text: string, patterns: RegExp[], radius = 450, cap = 24_000) {
  const spans: [number, number][] = [];
  for (const pattern of patterns) {
    const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
    for (const match of text.matchAll(global)) {
      const at = match.index ?? 0;
      spans.push([Math.max(0, at - radius), Math.min(text.length, at + radius)]);
      if (spans.length > 120) break;
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  let total = 0;
  const parts: string[] = [];
  for (const [start, end] of merged) {
    if (total > cap) break;
    parts.push(`[…] ${text.slice(start, end)} […]`);
    total += end - start;
  }
  return parts.join("\n\n");
}

const comparable = (text: string) =>
  text
    .toLowerCase()
    .replace(/[“”"]/g, '"')
    .replace(/[‘’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Keeps a model claim only if its quote is really in the filing. */
function grounded(quote: string, source: string) {
  const needle = comparable(quote).replace(/^\.+|\.+$/g, "");
  return needle.length >= 20 && comparable(source).includes(needle);
}

const ownPatterns = [
  /(accounted for|represented|comprised|constituted)[^.]{0,160}(%|percent)/i,
  /(largest|significant|major|principal|key) customers?/i,
  /(sole|single|limited)[- ]sources?d?/i,
  /(key|principal|significant|major|critical) (suppliers?|vendors?|manufacturers?)/i,
  /customer concentration/i,
  /concentration of (credit )?risk/i,
];

export async function ownDisclosure(ticker: string): Promise<OwnDisclosure | null> {
  const index = await tickerIndex();
  const row = index.byTicker.get(ticker);
  if (!row) return null;
  const filing = await latestAnnual(row.cik, ticker);
  if (!filing) return null;
  const key = `own:v1:${filing.accession}`;
  const cached = cachedLinks.safeParse(await readExtract(key));
  if (cached.success) return { filing, links: cached.data };
  const text = await filingText(filing.url);
  const context = excerpts(text, ownPatterns);
  let links: Link[] = [];
  if (context) {
    const { output } = await generateText({
      model: briefModel(),
      output: Output.object({ schema: extractionSchema }),
      prompt: `These are excerpts from ${filing.name}'s ${filing.form} filed ${filing.filed}.
List the named commercial relationships it discloses: customers (who buy from ${filing.name}), suppliers or contract manufacturers (who sell to it), and strategic partners. Include customers that are described only by revenue share (e.g. "one customer accounted for 14% of net sales") as "Unnamed customer".
Only use facts stated in the excerpts. For each one, copy the supporting sentence verbatim into quote. Revenue share must be a fraction of ${filing.name}'s revenue (14% -> 0.14), the most recent period disclosed. Skip generic mentions (e.g. "our customers") and governments unless named with a share.

${context}`,
    });
    links = output.relationships
      .filter((item) => grounded(item.quote, text))
      .map((item) => ({
        counterparty: item.counterparty,
        ticker: matchTicker(item.counterparty, index),
        role: item.relation,
        share: item.share,
        shareOf: "company" as const,
        period: item.period,
        quote: item.quote,
        source: filing,
      }));
  }
  await writeExtract(key, links);
  return { filing, links };
}

type SearchHit = {
  _source: {
    ciks: string[];
    display_names: string[];
    file_type: string;
    file_date: string;
    sics?: string[];
    adsh: string;
  };
};

async function fullText(query: string) {
  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - 18);
  const url = new URL("https://efts.sec.gov/LATEST/search-index");
  url.search = new URLSearchParams({
    q: query,
    forms: "10-K,20-F,40-F",
    dateRange: "custom",
    startdt: start.toISOString().slice(0, 10),
    enddt: new Date().toISOString().slice(0, 10),
  }).toString();
  const response = await fetch(url, {
    headers: secHeaders(),
    next: { revalidate: 86400 },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`EDGAR search returned ${response.status}`);
  const data = (await response.json()) as { hits?: { hits?: SearchHit[] } };
  return data.hits?.hits ?? [];
}

/**
 * Other listed companies whose annual report names this one next to
 * customer or supplier language. Unverified until checked one by one.
 */
export async function candidates(ticker: string): Promise<Candidate[]> {
  const index = await tickerIndex();
  const row = index.byTicker.get(ticker);
  if (!row) return [];
  const name = searchName(row.title);
  const [customers, suppliers] = await Promise.all([
    Promise.all(
      ['"largest customers"', '"largest customer"', '"significant customers"'].map(
        (phrase) => fullText(`"${name}" ${phrase}`).catch(() => []),
      ),
    ).then((lists) => lists.flat()),
    fullText(`"${name}" supplier`).catch(() => []),
  ]);
  const seen = new Set<string>([row.cik]);
  const out: Candidate[] = [];
  for (const [hits, query] of [
    [customers, "customers"],
    [suppliers, "suppliers"],
  ] as const) {
    for (const hit of hits) {
      const source = hit._source;
      const cik = String(Number(source.ciks[0]));
      const listed = index.byCik.get(cik);
      const sic = source.sics?.[0] ?? "";
      if (
        !listed ||
        seen.has(cik) ||
        !/^(10-K|20-F|40-F)$/.test(source.file_type) ||
        sic.startsWith("6") ||
        normalizeName(listed.title).startsWith(normalizeName(name))
      )
        continue;
      seen.add(cik);
      out.push({
        cik,
        name: listed.title,
        ticker: listed.ticker,
        form: source.file_type,
        filed: source.file_date,
        accession: source.adsh,
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K`,
        query,
      });
    }
  }
  return out.slice(0, 14);
}

export async function verify(ticker: string, cik: string): Promise<Verified> {
  const index = await tickerIndex();
  const target = index.byTicker.get(ticker);
  const listed = index.byCik.get(cik);
  if (!target || !listed) throw new Error("Unknown company.");
  const filing = await latestAnnual(cik, listed.ticker);
  const candidate: Candidate = {
    cik,
    name: listed.title,
    ticker: listed.ticker,
    form: filing?.form ?? "10-K",
    filed: filing?.filed ?? "",
    accession: filing?.accession ?? "",
    url: filing?.url ?? "",
    query: "customers",
  };
  if (!filing) return { candidate, link: null };
  const key = `rel:v1:${filing.accession}:${target.cik}`;
  const cached = cachedVerification.safeParse(await readExtract(key));
  if (cached.success) return { candidate, link: cached.data.link };
  const text = await filingText(filing.url);
  const name = searchName(target.title);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const context = excerpts(text, [new RegExp(escaped, "i")], 600, 9_000);
  let link: Link | null = null;
  if (context) {
    const { output } = await generateText({
      model: briefModel(),
      output: Output.object({ schema: verificationSchema }),
      prompt: `FILER: ${filing.name}. TARGET: ${target.title}.
From these excerpts of the filer's ${filing.form} (filed ${filing.filed}), what is the FILER's commercial relationship to the TARGET? "supplier" if the filer sells products or services to the target (the target is its customer); "customer" if the filer buys from the target; "partner" for joint ventures or alliances; "competitor" if named as a competitor; otherwise "mention".
If the filer states what share of its revenue comes from the target, give it as a fraction. Copy the single best supporting sentence verbatim.

${context}`,
    });
    if (output.relation !== "mention" && grounded(output.quote, text)) {
      link = {
        counterparty: listed.title,
        ticker: listed.ticker,
        role: output.relation,
        share: output.share,
        shareOf: "counterparty",
        period: output.period,
        quote: output.quote,
        source: filing,
      };
    }
  }
  await writeExtract(key, { link });
  return { candidate, link };
}
