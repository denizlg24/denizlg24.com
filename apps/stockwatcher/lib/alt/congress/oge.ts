import "server-only";
import { z } from "zod";
import { cached } from "../cache";
import { altFetch, altJson } from "../http";
import { AltUnavailable } from "../types";
import { type OgeListing, parseOgeListing, parseOgeText } from "./oge-parse";
import { pdfText } from "./pdf";
import { type Budget, spend } from "./pool";
import { rawTrade } from "./schemas";

const API = "https://extapps2.oge.gov/201/Presiden.nsf/API.xsp/v3/rest";

const listingSchema = z.array(
  z.object({
    name: z.string(),
    label: z.string(),
    url: z.string(),
    filedAt: z.string(),
    amended: z.boolean(),
  }),
);

const response = z.object({
  data: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      docDate: z.string(),
      amended: z.string().optional(),
    }),
  ),
});

/** Every 278-T OGE lists for the President, newest first. */
export async function trumpListings() {
  return cached({
    source: "congress.oge.list",
    key: "trump",
    ttlMs: 30 * 60_000,
    schema: listingSchema,
    load: async (): Promise<OgeListing[]> => {
      const query = new URLSearchParams({
        draw: "1",
        start: "0",
        length: "200",
        "search[value]": "Trump, Donald",
      });
      const parsed = response.safeParse(
        await altJson("OGE", `${API}?${query}`),
      );
      if (!parsed.success)
        throw new AltUnavailable("OGE sent an unexpected listing.");
      return parsed.data.data
        .filter((row) => /^Trump, Donald/i.test(row.name))
        .map(parseOgeListing)
        .filter((row): row is OgeListing => row !== null)
        .filter((row) => /278 Transaction/i.test(row.label))
        .sort((a, b) => b.filedAt.localeCompare(a.filedAt));
    },
  });
}

const documentSchema = z.object({
  parsed: z.boolean(),
  reason: z.string().nullable(),
  skipped: z.number(),
  rows: z.array(
    rawTrade.pick({
      asset: true,
      side: true,
      transactedAt: true,
      amountMin: true,
      amountMax: true,
      amountText: true,
    }),
  ),
});

export const ogeKey = (url: string) =>
  /PAS\+Index\/([0-9A-F]+)\//i.exec(url)?.[1] ?? url;

/** OGE's 278-T PDFs are scans with an OCR text layer; rows are read from that, so they carry `ocr: true`. */
export async function trumpReport(listing: OgeListing, budget: Budget) {
  return cached({
    source: "congress.oge.report",
    key: `v1:${ogeKey(listing.url)}`,
    ttlMs: Number.POSITIVE_INFINITY,
    schema: documentSchema,
    load: async () => {
      spend(budget);
      const file = await altFetch("OGE", listing.url, {
        timeoutMs: 90_000,
        maxBytes: 40_000_000,
      });
      const text = await pdfText(new Uint8Array(await file.arrayBuffer()));
      if (text == null)
        return {
          parsed: false,
          reason: "PDF not readable",
          skipped: 0,
          rows: [],
        };
      const result = parseOgeText(text, listing.filedAt);
      return result.rows.length
        ? {
            parsed: true,
            reason: null,
            skipped: result.skipped,
            rows: result.rows,
          }
        : {
            parsed: false,
            reason: "no rows recognised in the OCR text",
            skipped: result.skipped,
            rows: [],
          };
    },
  });
}
