export const newsSources = [
  "sec",
  "wires",
  "finnhub",
  "yahoo",
  "google",
  "gdelt",
] as const;
export type NewsSourceId = (typeof newsSources)[number];

export const sourceLabels: Record<NewsSourceId, string> = {
  sec: "SEC EDGAR",
  wires: "Press wire",
  finnhub: "Finnhub",
  yahoo: "Yahoo Finance",
  google: "Google News",
  gdelt: "GDELT",
};

export type NewsItem = {
  id: string;
  source: NewsSourceId;
  publisher: string;
  title: string;
  url: string;
  /** Unix seconds. */
  time: number;
  symbols: string[];
  summary?: string;
};

export type Company = { symbol: string; name: string | null };

export type NewsSource = {
  id: NewsSourceId;
  /** How long one fetch for one key stays fresh. */
  ttlMs: number;
  enabled: () => boolean;
  /**
   * One fetch: `key` is a symbol for per-symbol sources, or a fixed key for
   * sources that read one shared feed and match symbols themselves.
   */
  keys: (companies: Company[]) => string[];
  fetch: (key: string, companies: Company[]) => Promise<NewsItem[]>;
};
