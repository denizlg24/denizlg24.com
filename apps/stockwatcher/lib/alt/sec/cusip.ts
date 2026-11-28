import "server-only";
import { z } from "zod";
import { cached } from "../cache";
import { normaliseName } from "../entities";
import { AltUnavailable } from "../types";
import { archiveUrl, recentFilings, secText } from "./edgar";
import { figiFor, normaliseTicker } from "./openfigi";
import type { Position } from "./types";

const cusipSchema = z.object({ cusip: z.string() });

const is13DG = (form: string) => /^(SCHEDULE|SC) 13[DG]/.test(form);

async function fromSchedule13(cik: string): Promise<string[]> {
  const list = await recentFilings(cik, is13DG, "13dg", 6 * 3_600_000);
  const found = new Set<string>();
  for (const row of list.value.filings
    .filter((item) => /\.xml$/i.test(item.primaryDocument))
    .slice(0, 3)) {
    try {
      const xml = await secText(
        archiveUrl(cik, row.accession, "primary_doc.xml"),
      );
      for (const [, cusip] of xml.matchAll(
        /<issuerCusipNumber>\s*([0-9A-Za-z]{6,9})\s*</g,
      ))
        found.add(cusip.toUpperCase());
    } catch {
      // A filing that cannot be read leaves the next one to answer.
    }
    if (found.size) break;
  }
  return [...found];
}

/** Picks the candidate OpenFIGI maps to this ticker; with a single candidate and no answer from OpenFIGI, trusts it. */
async function verified(
  symbol: string,
  candidates: string[],
): Promise<string | null> {
  const wanted = normaliseTicker(symbol);
  for (const cusip of candidates) {
    const figi = await figiFor(cusip);
    if (figi?.ticker && normaliseTicker(figi.ticker) === wanted) return cusip;
  }
  const unresolved = await Promise.all(candidates.map(figiFor));
  return candidates.length === 1 && unresolved[0] === null
    ? candidates[0]
    : null;
}

/**
 * Ticker to CUSIP. EDGAR has no such table, so the CUSIP is read from the
 * company's most recent Schedule 13D/G cover page (XML since 2024) and checked
 * against OpenFIGI; failing that, from the same issuer's name in a large
 * filer's 13F, checked the same way. Cached forever.
 */
export async function cusipFor(
  symbol: string,
  cik: string,
  name: string,
  largestHoldings: () => Promise<Position[][]>,
): Promise<string> {
  const { value } = await cached({
    source: "sec-cusip",
    key: symbol.toUpperCase(),
    ttlMs: Number.POSITIVE_INFINITY,
    schema: cusipSchema,
    load: async () => {
      const direct = await verified(symbol, await fromSchedule13(cik));
      if (direct) return { cusip: direct };
      const wanted = normaliseName(name);
      const candidates = new Map<string, number>();
      for (const positions of await largestHoldings())
        for (const position of positions)
          if (
            !position.putCall &&
            position.shareType === "SH" &&
            normaliseName(position.issuer) === wanted
          )
            candidates.set(
              position.cusip,
              (candidates.get(position.cusip) ?? 0) + position.value,
            );
      const ranked = [...candidates.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([cusip]) => cusip);
      const match = await verified(symbol, ranked.slice(0, 6));
      if (!match)
        throw new AltUnavailable(
          `No CUSIP could be established for ${symbol}.`,
          404,
          false,
        );
      return { cusip: match };
    },
  });
  return value.cusip;
}
