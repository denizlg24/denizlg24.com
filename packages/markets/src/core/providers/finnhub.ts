import { z } from "zod";
import type {
  AssetType,
  CompanyNewsItem,
  CompanyProfile,
  SymbolSearchResult,
} from "../../schemas";
import {
  BudgetExhaustedError,
  type BudgetPort,
  type MarketDataProvider,
  ProviderError,
} from "../ports";

const BASE_URL = "https://finnhub.io/api/v1/";

/**
 * Finnhub covers the things Tiingo and EDGAR do not: company profiles with a
 * logo, and news. Its candle endpoint moved behind a paid plan, so this adapter
 * deliberately implements no price method — a price path that silently 403s is
 * worse than one that does not exist.
 */

const searchSchema = z.object({
  result: z
    .array(
      z.object({
        description: z.string().nullable().default(null),
        displaySymbol: z.string().nullable().default(null),
        symbol: z.string(),
        type: z.string().nullable().default(null),
      }),
    )
    .default([]),
});

const profileSchema = z.object({
  ticker: z.string().nullable().default(null),
  name: z.string().nullable().default(null),
  country: z.string().nullable().default(null),
  exchange: z.string().nullable().default(null),
  finnhubIndustry: z.string().nullable().default(null),
  ipo: z.string().nullable().default(null),
  logo: z.string().nullable().default(null),
  weburl: z.string().nullable().default(null),
  /** Both of these arrive in millions of the listing currency. */
  marketCapitalization: z.number().nullable().default(null),
  shareOutstanding: z.number().nullable().default(null),
});

const newsSchema = z.array(
  z.object({
    id: z.union([z.number(), z.string()]).nullable().default(null),
    category: z.string().nullable().default(null),
    datetime: z.number(),
    headline: z.string().nullable().default(null),
    image: z.string().nullable().default(null),
    related: z.string().nullable().default(null),
    source: z.string().nullable().default(null),
    summary: z.string().nullable().default(null),
    url: z.string(),
  }),
);

/** Finnhub's own vocabulary, mapped onto the asset types the schemas allow. */
function toAssetType(type: string | null): AssetType {
  switch ((type ?? "").toUpperCase()) {
    case "ETP":
    case "ETF":
      return "etf";
    case "MUTUAL FUND":
      return "mutualFund";
    case "CRYPTO":
      return "crypto";
    case "FX":
      return "fx";
    case "INDEX":
      return "index";
    default:
      return "stock";
  }
}

/** Absolute http(s) only — the schemas reject anything else, including "". */
function toUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function toPositive(value: number | null, scale = 1): number | undefined {
  if (value === null || !Number.isFinite(value) || value <= 0) return undefined;
  return value * scale;
}

export interface FinnhubOptions {
  apiKey: string;
  budget: BudgetPort;
  fetchImpl?: typeof fetch;
}

export class FinnhubProvider implements MarketDataProvider {
  readonly name = "finnhub" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: FinnhubOptions) {
    if (!options.apiKey) throw new Error("A Finnhub API key is required");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Same contract as the Tiingo adapter: reserve first, hand back on a throw. */
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    params: Record<string, string | undefined> = {},
  ): Promise<T> {
    const allowed = await this.options.budget.consume("finnhub", 1);
    if (!allowed) throw new BudgetExhaustedError("finnhub");

    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        // Header rather than the `token` query parameter, so the key stays out
        // of proxy and CDN logs.
        headers: { "X-Finnhub-Token": this.options.apiKey },
      });
    } catch (error) {
      await this.options.budget.release("finnhub", 1);
      throw new ProviderError("finnhub", `Request failed: ${String(error)}`);
    }

    if (response.status === 429) {
      throw new ProviderError("finnhub", "Rate limited by Finnhub", 429);
    }
    if (!response.ok) {
      throw new ProviderError(
        "finnhub",
        `${response.status} ${response.statusText}`,
        response.status,
      );
    }

    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ProviderError(
        "finnhub",
        `Unexpected response shape: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  async searchSymbols(
    query: string,
    limit: number,
  ): Promise<SymbolSearchResult[]> {
    const { result } = await this.request("search", searchSchema, { q: query });
    return result.slice(0, limit).map((item, index) => ({
      ticker: (item.displaySymbol ?? item.symbol).toUpperCase(),
      name: item.description ?? item.symbol,
      assetType: toAssetType(item.type),
      // Finnhub returns its matches best-first without a score; position is the
      // only ranking signal available, so it becomes one.
      score: 1 / (index + 1),
    }));
  }

  async getProfile(ticker: string): Promise<CompanyProfile | null> {
    const upper = ticker.toUpperCase();
    const profile = await this.request("stock/profile2", profileSchema, {
      symbol: upper,
    });
    // An unknown symbol comes back as `{}` with a 200 rather than a 404.
    if (!profile.name && !profile.ticker) return null;

    return {
      ticker: (profile.ticker ?? upper).toUpperCase(),
      name: profile.name ?? upper,
      sector: profile.finnhubIndustry ?? undefined,
      industry: profile.finnhubIndustry ?? undefined,
      country: profile.country ?? undefined,
      website: toUrl(profile.weburl),
      logoUrl: toUrl(profile.logo),
      marketCap: toPositive(profile.marketCapitalization, 1e6),
      sharesOutstanding: toPositive(profile.shareOutstanding, 1e6),
      ipoDate: profile.ipo?.slice(0, 10) || undefined,
      updatedAt: new Date().toISOString(),
    };
  }

  async getNews(ticker: string, limit: number): Promise<CompanyNewsItem[]> {
    const upper = ticker.toUpperCase();
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);

    const items = await this.request("company-news", newsSchema, {
      symbol: upper,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });

    const news: CompanyNewsItem[] = [];
    for (const item of items) {
      if (news.length === limit) break;
      const url = toUrl(item.url);
      if (!item.headline || !url) continue;
      news.push({
        // The numeric id repeats across symbols on syndicated wire stories, so
        // the ticker is part of the key the cache upserts on.
        id: `${upper}:${item.id ?? url}`,
        ticker: upper,
        headline: item.headline,
        summary: item.summary ?? undefined,
        source: item.source ?? undefined,
        url,
        imageUrl: toUrl(item.image),
        publishedAt: new Date(item.datetime * 1000).toISOString(),
      });
    }
    return news;
  }
}
