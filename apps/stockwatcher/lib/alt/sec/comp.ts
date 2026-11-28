import "server-only";
import { fetchCompanyFacts, lookupCik } from "../../sec-data";
import { cached } from "../cache";
import { AltBadRequest, AltUnavailable } from "../types";
import { archiveUrl, recentFilings, secText } from "./edgar";
import { parseSummaryCompensation, payVersusPerformance } from "./parse-comp";
import { execCompSchema, summaryTableSchema } from "./schemas";
import type { ExecComp } from "./types";

/** The latest proxy statement's Summary Compensation Table (best effort) and the pay-versus-performance facts. */
export async function execComp(symbolInput: string) {
  const symbol = symbolInput.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,10}$/.test(symbol))
    throw new AltBadRequest("symbol is not a valid ticker.");
  const company = await lookupCik(symbol);
  if (!company)
    throw new AltUnavailable(`${symbol} is not an SEC registrant.`, 404, false);
  return cached({
    source: "sec-comp",
    key: symbol,
    ttlMs: 12 * 3_600_000,
    schema: execCompSchema,
    load: async (): Promise<ExecComp> => {
      const [list, facts] = await Promise.all([
        recentFilings(
          company.cik,
          (form) => form === "DEF 14A",
          "def14a",
          3_600_000,
        ),
        fetchCompanyFacts(company.cik).then(payVersusPerformance, () => []),
      ]);
      const filing = list.value.filings[0];
      if (!filing)
        return {
          symbol,
          company: company.name,
          proxy: null,
          summaryTable: {
            parsed: false,
            rows: [],
            note: "No DEF 14A proxy statement was found.",
          },
          payVersusPerformance: facts,
        };
      const url = archiveUrl(
        company.cik,
        filing.accession,
        filing.primaryDocument,
      );
      const html = await cached({
        source: "sec-proxy-table",
        key: filing.accession,
        ttlMs: Number.POSITIVE_INFINITY,
        schema: summaryTableSchema,
        load: async () =>
          parseSummaryCompensation(
            await secText(url, { timeoutMs: 60_000, maxBytes: 60_000_000 }),
          ),
      });
      return {
        symbol,
        company: company.name,
        proxy: { accession: filing.accession, filed: filing.filed, url },
        summaryTable: html.value,
        payVersusPerformance: facts,
      };
    },
  });
}
