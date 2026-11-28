import "server-only";
import { z } from "zod";
import { lookupCik } from "../../sec-data";
import { cached } from "../cache";
import { AltBadRequest, AltUnavailable } from "../types";
import { archiveUrl, efts, padCik, secJson, secText } from "./edgar";
import { tickersFor } from "./openfigi";
import { parseNport } from "./parse-nport";
import { etfHoldingsSchema } from "./schemas";
import type { EtfHoldings } from "./types";

const TOP = 100;

const fundListSchema = z.object({
  fields: z.array(z.string()),
  data: z.array(z.array(z.union([z.string(), z.number()]))),
});

async function fundRow(
  symbol: string,
): Promise<{ cik: string; seriesId: string | null } | null> {
  const list = await cached({
    source: "sec-fund-tickers",
    key: "company_tickers_mf",
    ttlMs: 86_400_000,
    schema: fundListSchema,
    load: () =>
      secJson(
        "https://www.sec.gov/files/company_tickers_mf.json",
        fundListSchema,
        { maxBytes: 20_000_000 },
      ),
  });
  const { fields, data } = list.value;
  const at = (name: string) => fields.indexOf(name);
  const row = data.find(
    (item) => String(item[at("symbol")]).toUpperCase() === symbol,
  );
  if (row)
    return {
      cik: String(row[at("cik")]),
      seriesId: String(row[at("seriesId")]),
    };
  const company = await lookupCik(symbol);
  return company ? { cik: company.cik, seriesId: null } : null;
}

/** Latest public N-PORT for the fund behind a ticker, with the largest lines tickered through OpenFIGI. */
export async function etfHoldings(symbolInput: string) {
  const symbol = symbolInput.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,10}$/.test(symbol))
    throw new AltBadRequest("symbol is not a valid ticker.");
  return cached({
    source: "sec-nport",
    key: symbol,
    ttlMs: 6 * 3_600_000,
    schema: etfHoldingsSchema,
    load: async (): Promise<EtfHoldings> => {
      const fund = await fundRow(symbol);
      if (!fund)
        throw new AltUnavailable(
          `${symbol} is not a fund registered with the SEC.`,
          404,
          false,
        );
      const found = await efts({
        q: fund.seriesId ? `"${fund.seriesId}"` : "",
        forms: "NPORT-P",
        ciks: padCik(fund.cik),
        dateRange: "custom",
        startdt: new Date(Date.now() - 400 * 86_400_000)
          .toISOString()
          .slice(0, 10),
        enddt: new Date().toISOString().slice(0, 10),
      });
      const latest = found.hits.sort(
        (a, b) =>
          b._source.file_date.localeCompare(a._source.file_date) ||
          (b._source.period_ending ?? "").localeCompare(
            a._source.period_ending ?? "",
          ),
      )[0];
      if (!latest)
        throw new AltUnavailable(
          `No public N-PORT report was found for ${symbol}.`,
          404,
          false,
        );
      const xml = await secText(
        archiveUrl(fund.cik, latest._source.adsh, "primary_doc.xml"),
        {
          timeoutMs: 90_000,
          maxBytes: 150_000_000,
        },
      );
      const report = parseNport(xml, TOP);
      const tickers = await tickersFor(
        report.holdings
          .slice(0, 50)
          .flatMap((holding) => (holding.cusip ? [holding.cusip] : [])),
      );
      const holdings = report.holdings.map((holding) => ({
        ...holding,
        ticker: holding.cusip ? (tickers.get(holding.cusip) ?? null) : null,
      }));
      return {
        symbol,
        fund: report.registrant || latest._source.display_names[0] || symbol,
        series: report.series,
        accession: latest._source.adsh,
        filed: latest._source.file_date,
        reportDate: report.reportDate ?? latest._source.period_ending ?? "",
        netAssets: report.netAssets,
        holdingCount: report.holdingCount,
        topPercent: holdings.reduce(
          (total, holding) => total + (holding.percentOfNetAssets ?? 0),
          0,
        ),
        holdings,
      };
    },
  });
}
