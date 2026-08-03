import { z } from "zod";
import type { Filing, FundamentalPeriod, MarketSymbol } from "../../schemas";
import {
  BudgetExhaustedError,
  type BudgetPort,
  type MarketDataProvider,
  ProviderError,
} from "../ports";
import {
  type CompanyFactsPayload,
  companyFactsPayloadSchema,
  distillCompanyFacts,
} from "./edgar-facts";

const DATA_BASE = "https://data.sec.gov";
const WWW_BASE = "https://www.sec.gov";

/** SEC caps callers at 10 requests a second across all endpoints. */
const MIN_REQUEST_INTERVAL_MS = 110;

export function padCik(cik: string | number): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

const submissionsSchema = z.object({
  cik: z.union([z.string(), z.number()]),
  name: z.string().optional(),
  tickers: z.array(z.string()).optional(),
  sicDescription: z.string().optional(),
  filings: z
    .object({
      recent: z
        .object({
          accessionNumber: z.array(z.string()),
          filingDate: z.array(z.string()),
          reportDate: z.array(z.string()).optional(),
          form: z.array(z.string()),
          primaryDocument: z.array(z.string()).optional(),
          primaryDocDescription: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
});

const companyTickersSchema = z.record(
  z.string(),
  z.object({
    cik_str: z.number(),
    ticker: z.string(),
    title: z.string(),
  }),
);

export interface EdgarOptions {
  /**
   * SEC rejects requests without a contact address. Format is
   * "Organisation contact@example.com"; a blank or generic value gets the
   * caller blocked, not rate-limited.
   */
  userAgent: string;
  budget: BudgetPort;
  fetchImpl?: typeof fetch;
}

export class EdgarProvider implements MarketDataProvider {
  readonly name = "edgar" as const;
  private readonly fetchImpl: typeof fetch;
  private nextRequestAt = 0;

  constructor(private readonly options: EdgarOptions) {
    if (!options.userAgent.trim()) {
      throw new Error("SEC_EDGAR_USER_AGENT must carry a contact address");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * The slot is claimed synchronously, before the wait. Advancing
   * `nextRequestAt` after the sleep would let every concurrent caller read the
   * same value, sleep the same interval and then fire together — SEC blocks
   * offenders rather than rate-limiting them.
   */
  private async throttle(): Promise<void> {
    const slot = Math.max(Date.now(), this.nextRequestAt);
    this.nextRequestAt = slot + MIN_REQUEST_INTERVAL_MS;
    const wait = slot - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }

  private async request<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    const allowed = await this.options.budget.consume("edgar", 1);
    if (!allowed) throw new BudgetExhaustedError("edgar");
    await this.throttle();

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          "User-Agent": this.options.userAgent,
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
      });
    } catch (error) {
      await this.options.budget.release("edgar", 1);
      throw new ProviderError("edgar", `Request failed: ${String(error)}`);
    }

    if (response.status === 404) {
      throw new ProviderError("edgar", "Not found", 404);
    }
    if (!response.ok) {
      throw new ProviderError(
        "edgar",
        `${response.status} ${response.statusText}`,
        response.status,
      );
    }

    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ProviderError(
        "edgar",
        `Unexpected response shape: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  /**
   * The ticker to CIK map for the whole market in one request. Refreshed
   * weekly by cron; there is no per-symbol lookup endpoint.
   */
  async listSymbols(): Promise<MarketSymbol[]> {
    const payload = await this.request(
      `${WWW_BASE}/files/company_tickers.json`,
      companyTickersSchema,
    );
    const updatedAt = new Date().toISOString();
    return Object.values(payload).map((row) => ({
      ticker: row.ticker.toUpperCase(),
      name: row.title,
      assetType: "stock" as const,
      currency: "USD",
      cik: padCik(row.cik_str),
      active: true,
      updatedAt,
    }));
  }

  /**
   * companyfacts is several megabytes of every concept the filer has ever
   * tagged. It is distilled here and only the tracked facts are returned, so
   * the raw payload never reaches the cache or the browser.
   *
   * A 404 means the filer tags no XBRL facts at all — every ETF and trust in
   * `company_tickers.json` is in that position, SPY included. That is a fact
   * about the filer rather than a failure, so it reads as no periods and joins
   * the path a company with nothing distillable already takes.
   */
  async getFundamentals(
    cik: string,
    ticker: string,
  ): Promise<FundamentalPeriod[]> {
    const padded = padCik(cik);
    let payload: CompanyFactsPayload;
    try {
      payload = await this.request(
        `${DATA_BASE}/api/xbrl/companyfacts/CIK${padded}.json`,
        companyFactsPayloadSchema,
      );
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return [];
      throw error;
    }

    const updatedAt = new Date().toISOString();
    return distillCompanyFacts(payload).map((period) => ({
      cik: padded,
      ticker: ticker.toUpperCase(),
      fiscalYear: period.fiscalYear,
      fiscalPeriod: period.fiscalPeriod,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      form: period.form,
      filed: period.filed,
      accession: period.accession,
      facts: period.facts,
      updatedAt,
    }));
  }

  async getFilings(
    cik: string,
    ticker: string,
    limit: number,
  ): Promise<Filing[]> {
    const padded = padCik(cik);
    const payload = await this.request(
      `${DATA_BASE}/submissions/CIK${padded}.json`,
      submissionsSchema,
    );
    const recent = payload.filings?.recent;
    if (!recent) return [];

    // The submissions feed is columnar: parallel arrays keyed by index.
    const filings: Filing[] = [];
    for (
      let i = 0;
      i < recent.accessionNumber.length && filings.length < limit;
      i++
    ) {
      const accession = recent.accessionNumber[i];
      const form = recent.form[i];
      const filed = recent.filingDate[i];
      if (!accession || !form || !filed) continue;

      const bare = accession.replace(/-/g, "");
      const primaryDocument = recent.primaryDocument?.[i];
      filings.push({
        cik: padded,
        ticker: ticker.toUpperCase(),
        accession,
        form,
        filed,
        periodOfReport: recent.reportDate?.[i] || undefined,
        primaryDocument,
        url: primaryDocument
          ? `${WWW_BASE}/Archives/edgar/data/${Number(padded)}/${bare}/${primaryDocument}`
          : `${WWW_BASE}/Archives/edgar/data/${Number(padded)}/${bare}/`,
        description: recent.primaryDocDescription?.[i] || undefined,
      });
    }
    return filings;
  }
}
