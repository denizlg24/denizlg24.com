import "server-only";
import { z } from "zod";
import { cached } from "../cache";
import { altFetch } from "../http";
import { AltUnavailable } from "../types";
import {
  type HouseIndexEntry,
  parseAnnualText,
  parseHouseIndex,
  parsePtrText,
} from "./house-parse";
import { pdfText } from "./pdf";
import { type Budget, spend } from "./pool";
import { annualDocument, ptrDocument } from "./schemas";
import { unzipEntry } from "./zip";

const BASE = "https://disclosures-clerk.house.gov/public_disc";
export const houseDocumentUrl = (
  kind: "ptr" | "annual",
  year: number,
  docId: string,
) =>
  kind === "ptr"
    ? `${BASE}/ptr-pdfs/${year}/${docId}.pdf`
    : `${BASE}/financial-pdfs/${year}/${docId}.pdf`;

const indexSchema = z.array(
  z.object({
    prefix: z.string(),
    last: z.string(),
    first: z.string(),
    suffix: z.string(),
    type: z.string(),
    stateDst: z.string(),
    year: z.number(),
    filedAt: z.string(),
    docId: z.string(),
  }),
);

export async function houseIndex(year: number) {
  const current = year === new Date().getFullYear();
  return cached({
    source: "congress.house.index",
    key: String(year),
    ttlMs: current ? 10 * 60_000 : 12 * 3_600_000,
    schema: indexSchema,
    load: async (): Promise<HouseIndexEntry[]> => {
      const response = await altFetch(
        "House Clerk",
        `${BASE}/financial-pdfs/${year}FD.zip`,
        {
          timeoutMs: 60_000,
          maxBytes: 40_000_000,
        },
      );
      const xml = unzipEntry(
        new Uint8Array(await response.arrayBuffer()),
        `${year}FD.xml`,
      );
      if (!xml)
        throw new AltUnavailable("House Clerk index archive is not readable.");
      return parseHouseIndex(new TextDecoder().decode(xml));
    },
  });
}

async function fetchPdf(url: string) {
  const response = await altFetch("House Clerk", url, {
    timeoutMs: 60_000,
    maxBytes: 30_000_000,
  });
  return new Uint8Array(await response.arrayBuffer());
}

/** One PTR by DocID. Immutable once filed, so cached forever; paper scans are cached as `parsed: false`. */
export async function housePtr(entry: HouseIndexEntry, budget: Budget) {
  return cached({
    source: "congress.house.ptr",
    key: `v1:${entry.year}:${entry.docId}`,
    ttlMs: Number.POSITIVE_INFINITY,
    schema: ptrDocument,
    load: async () => {
      spend(budget);
      const text = await pdfText(
        await fetchPdf(houseDocumentUrl("ptr", entry.year, entry.docId)),
      );
      if (text == null)
        return { parsed: false, reason: "PDF not readable", trades: [] };
      const result = parsePtrText(text);
      return result.parsed
        ? { parsed: true, reason: null, trades: result.trades }
        : { parsed: false, reason: result.reason, trades: [] };
    },
  });
}

export async function houseAnnual(entry: HouseIndexEntry, budget: Budget) {
  return cached({
    source: "congress.house.annual",
    key: `v1:${entry.year}:${entry.docId}`,
    ttlMs: Number.POSITIVE_INFINITY,
    schema: annualDocument,
    load: async () => {
      spend(budget);
      const text = await pdfText(
        await fetchPdf(houseDocumentUrl("annual", entry.year, entry.docId)),
      );
      const parsed = text == null ? null : parseAnnualText(text);
      return parsed
        ? { parsed: true, ...parsed }
        : {
            parsed: false,
            holdings: [],
            assetsMid: null,
            assetsLow: null,
            assetsHigh: null,
            liabilitiesMid: null,
            flags: ["scanned or unreadable filing"],
          };
    },
  });
}
