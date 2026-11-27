import "server-only";
import { z } from "zod";
import { newsWire as yahooWire } from "../market";
import { lookupCik, secFetch } from "../sec-data";
import { parseFeed } from "./feed";
import type { Company, NewsItem, NewsSource } from "./types";

const fetchText = async (url: string, timeoutMs = 12_000) => {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        process.env.SEC_USER_AGENT ||
        "Stockwatcher research contact research@denizlg24.com",
      Accept: "application/rss+xml, application/xml, application/json, */*",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok)
    throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
  return response.text();
};

const legalSuffix =
  /[,.]?\s+(inc|corp|corporation|co|ltd|plc|holdings|group|sa|nv|ag)\.?$/i;

/** "NVIDIA CORP" → "NVIDIA": the name a headline would use. */
function nameFor(company: Company) {
  let name = (company.name ?? company.symbol).trim();
  for (let previous = ""; previous !== name; ) {
    previous = name;
    name = name.replace(legalSuffix, "").trim();
  }
  return name;
}

const byPerSymbol = (limit: number) => (companies: Company[]) =>
  companies.slice(0, limit).map((company) => company.symbol);

const companyOf = (companies: Company[], symbol: string): Company =>
  companies.find((company) => company.symbol === symbol) ?? {
    symbol,
    name: null,
  };

const yahoo: NewsSource = {
  id: "yahoo",
  ttlMs: 5 * 60_000,
  enabled: () => true,
  keys: byPerSymbol(40),
  fetch: async (symbol) =>
    (await yahooWire([symbol])).map((item) => ({
      id: item.id,
      source: "yahoo",
      publisher: item.publisher,
      title: item.title,
      url: item.url,
      time: item.time,
      symbols: item.symbols,
    })),
};

const eightKItems: Record<string, string> = {
  "1.01": "material agreement",
  "1.02": "agreement terminated",
  "1.03": "bankruptcy",
  "2.01": "acquisition or disposal",
  "2.02": "results of operations",
  "2.03": "new debt obligation",
  "2.05": "restructuring costs",
  "2.06": "impairment",
  "3.01": "listing notice",
  "3.02": "unregistered share sale",
  "4.01": "auditor change",
  "4.02": "non-reliance on financials",
  "5.01": "change in control",
  "5.02": "officer or director change",
  "5.03": "bylaws amended",
  "5.07": "shareholder vote",
  "7.01": "Regulation FD disclosure",
  "8.01": "other events",
};

const submissions = z.object({
  name: z.string(),
  filings: z.object({
    recent: z.object({
      accessionNumber: z.array(z.string()),
      filingDate: z.array(z.string()),
      acceptanceDateTime: z.array(z.string()),
      form: z.array(z.string()),
      primaryDocument: z.array(z.string()),
      items: z.array(z.string()).optional(),
    }),
  }),
});

const secForms = new Set(["8-K", "8-K/A", "6-K", "4"]);
const secWindowDays = 14;

const sec: NewsSource = {
  id: "sec",
  ttlMs: 10 * 60_000,
  enabled: () => true,
  keys: byPerSymbol(15),
  fetch: async (symbol) => {
    const company = await lookupCik(symbol);
    if (!company) return [];
    const cik = company.cik.padStart(10, "0");
    const response = await secFetch(
      `https://data.sec.gov/submissions/CIK${cik}.json`,
      { maxBytes: 20_000_000 },
    );
    const data = submissions.parse(await response.json());
    const recent = data.filings.recent;
    const since = Date.now() - secWindowDays * 86_400_000;
    const items: NewsItem[] = [];
    for (let i = 0; i < recent.form.length && items.length < 12; i++) {
      const form = recent.form[i];
      if (!secForms.has(form)) continue;
      const accepted = Date.parse(recent.acceptanceDateTime[i] ?? "");
      const time = Number.isFinite(accepted)
        ? accepted
        : Date.parse(recent.filingDate[i]);
      if (!Number.isFinite(time) || time < since) break;
      const accession = recent.accessionNumber[i];
      const described =
        form === "4"
          ? "insider transaction (Form 4)"
          : (recent.items?.[i] ?? "")
              .split(",")
              .map((code) => eightKItems[code.trim()])
              .filter(Boolean)
              .join(", ") || form;
      items.push({
        id: `sec:${accession}`,
        source: "sec",
        publisher: "SEC EDGAR",
        title: `${data.name} files ${form}: ${described}`,
        url: `https://www.sec.gov/Archives/edgar/data/${Number(company.cik)}/${accession.replace(/-/g, "")}/${recent.primaryDocument[i]}`,
        time: Math.floor(time / 1000),
        symbols: [symbol],
      });
    }
    return items;
  },
};

const google: NewsSource = {
  id: "google",
  ttlMs: 10 * 60_000,
  enabled: () => true,
  keys: byPerSymbol(12),
  fetch: async (symbol, companies) => {
    const company = companyOf(companies, symbol);
    const query = `"${nameFor(company)}" OR "${symbol} stock" when:3d`;
    const xml = await fetchText(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
    );
    return parseFeed(xml)
      .slice(0, 15)
      .map((entry) => ({
        id: `google:${entry.link}`,
        source: "google",
        publisher: entry.source ?? "Google News",
        title: entry.source
          ? entry.title.replace(
              new RegExp(
                ` - ${entry.source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
              ),
              "",
            )
          : entry.title,
        url: entry.link,
        time: entry.time,
        symbols: [symbol],
      }));
  },
};

const gdeltArticles = z.object({
  articles: z
    .array(
      z.object({
        url: z.string(),
        title: z.string(),
        seendate: z.string(),
        domain: z.string(),
      }),
    )
    .optional(),
});

/** GDELT allows one request every five seconds per client. */
const gdeltGate = globalThis as typeof globalThis & { gdeltNext?: number };
async function gdeltSlot() {
  const now = Date.now();
  const slot = Math.max(now, gdeltGate.gdeltNext ?? 0);
  gdeltGate.gdeltNext = slot + 5_500;
  if (slot > now)
    await new Promise((resolve) => setTimeout(resolve, slot - now));
}

const gdeltTime = (seen: string) => {
  const match = seen.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return match
    ? Math.floor(
        Date.UTC(
          +match[1],
          +match[2] - 1,
          +match[3],
          +match[4],
          +match[5],
          +match[6],
        ) / 1000,
      )
    : 0;
};

const gdelt: NewsSource = {
  id: "gdelt",
  ttlMs: 20 * 60_000,
  enabled: () => true,
  keys: (companies) =>
    companies.length
      ? [
          companies
            .slice(0, 10)
            .map((company) => company.symbol)
            .sort()
            .join(","),
        ]
      : [],
  fetch: async (key, companies) => {
    const targets = key
      .split(",")
      .map((symbol) => companyOf(companies, symbol))
      .map((company) => ({ ...company, name: nameFor(company) }))
      .filter((company) => company.name.length >= 3);
    if (!targets.length) return [];
    const query = `(${targets.map((company) => `"${company.name}"`).join(" OR ")}) sourcelang:english`;
    await gdeltSlot();
    const body = await fetchText(
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=75&timespan=2d&sort=datedesc`,
      20_000,
    );
    const parsed = gdeltArticles.safeParse(JSON.parse(body));
    if (!parsed.success) return [];
    return (parsed.data.articles ?? []).flatMap((article) => {
      const lower = article.title.toLowerCase();
      const symbols = targets
        .filter((company) => lower.includes(company.name.toLowerCase()))
        .map((company) => company.symbol);
      if (!symbols.length || !article.url.startsWith("https://")) return [];
      return [
        {
          id: `gdelt:${article.url}`,
          source: "gdelt" as const,
          publisher: article.domain,
          title: article.title,
          url: article.url,
          time: gdeltTime(article.seendate),
          symbols,
        },
      ];
    });
  },
};

const finnhubNews = z.array(
  z.object({
    id: z.number(),
    headline: z.string(),
    url: z.string(),
    source: z.string(),
    datetime: z.number(),
    summary: z.string().optional(),
  }),
);

const finnhubKey = () => process.env.FINNHUB_API_KEY?.trim() || null;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const finnhub: NewsSource = {
  id: "finnhub",
  ttlMs: 10 * 60_000,
  enabled: () => Boolean(finnhubKey()),
  keys: (companies) =>
    byPerSymbol(15)(
      companies.filter((company) => /^[A-Z.]{1,6}$/.test(company.symbol)),
    ),
  fetch: async (symbol) => {
    const now = Date.now();
    const body = await fetchText(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${isoDay(now - 3 * 86_400_000)}&to=${isoDay(now)}&token=${finnhubKey()}`,
    );
    const parsed = finnhubNews.safeParse(JSON.parse(body));
    if (!parsed.success) return [];
    return parsed.data
      .filter((item) => item.url.startsWith("https://") && item.headline)
      .slice(0, 15)
      .map((item) => ({
        id: `finnhub:${item.id}`,
        source: "finnhub" as const,
        publisher: item.source,
        title: item.headline,
        url: item.url,
        time: item.datetime,
        symbols: [symbol],
        summary: item.summary?.slice(0, 600) || undefined,
      }));
  },
};

/** Company-news feeds of the wires that serve server requests (GlobeNewswire refuses them). */
const wireFeeds = [
  {
    publisher: "PR Newswire",
    url: "https://www.prnewswire.com/rss/news-releases-list.rss",
  },
  {
    publisher: "PR Newswire",
    url: "https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss",
  },
  {
    publisher: "Business Wire",
    url: "https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeGVtRWA==",
  },
];

const listingTag =
  /\b(?:NYSE(?:\s+American)?|NASDAQ|Nasdaq(?:GS|GM|CM)?|AMEX|TSX(?:-V)?|OTCQX|OTCQB|LSE|ASX)\s*:\s*([A-Z][A-Z.]{0,6})\b/g;

const wires: NewsSource = {
  id: "wires",
  ttlMs: 10 * 60_000,
  enabled: () => true,
  keys: (companies) => (companies.length ? ["feeds"] : []),
  fetch: async (_key, companies) => {
    const wanted = new Set(companies.map((company) => company.symbol));
    const feeds = await Promise.allSettled(
      wireFeeds.map(async (feed) => ({
        feed,
        entries: parseFeed(await fetchText(feed.url)),
      })),
    );
    return feeds.flatMap((result) => {
      if (result.status !== "fulfilled") return [];
      const { feed, entries } = result.value;
      return entries.flatMap((entry) => {
        const tagged = [
          ...`${entry.title} ${entry.summary}`.matchAll(listingTag),
        ].map((match) => match[1].replace(/\.$/, ""));
        const symbols = [...new Set(tagged)].filter((symbol) =>
          wanted.has(symbol),
        );
        return symbols.length
          ? [
              {
                id: `wires:${entry.link}`,
                source: "wires" as const,
                publisher: feed.publisher,
                title: entry.title,
                url: entry.link,
                time: entry.time,
                symbols,
                summary: entry.summary || undefined,
              },
            ]
          : [];
      });
    });
  },
};

export const sources: NewsSource[] = [
  sec,
  wires,
  finnhub,
  yahoo,
  google,
  gdelt,
];
