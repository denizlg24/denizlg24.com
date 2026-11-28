import { parseAmount, usDate } from "./house-parse";
import type { Owner, Side } from "./types";

export type SenateListing = {
  uuid: string;
  kind: "ptr" | "paper" | "annual" | "other";
  first: string;
  last: string;
  filerType: string;
  title: string;
  filedAt: string;
  path: string;
};

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** One row of `/search/report/data/`: [first, last, filer type, report link, date received]. */
export function parseSenateListing(
  row: readonly string[],
): SenateListing | null {
  if (row.length < 5) return null;
  const link =
    /href="(\/search\/view\/(ptr|paper|annual)\/([^/"]+)\/)"[^>]*>([\s\S]*?)<\/a>/.exec(
      row[3],
    );
  const filedAt = usDate(row[4].trim());
  if (!link || !filedAt) return null;
  return {
    uuid: link[3],
    kind:
      link[2] === "ptr" || link[2] === "paper" || link[2] === "annual"
        ? link[2]
        : "other",
    first: textOf(row[0]),
    last: textOf(row[1]),
    filerType: textOf(row[2]),
    title: textOf(link[4]),
    filedAt,
    path: link[1],
  };
}

export type SenateRow = {
  owner: Owner | null;
  asset: string;
  ticker: string | null;
  assetType: string | null;
  side: Side;
  transactedAt: string | null;
  notifiedAt: null;
  amountMin: number | null;
  amountMax: number | null;
  amountText: string;
  note: string | null;
};

const ownerOf = (value: string): Owner | null => {
  const text = value.toLowerCase();
  if (text.startsWith("spouse")) return "spouse";
  if (text.startsWith("joint")) return "joint";
  if (text.startsWith("child") || text.startsWith("dependent"))
    return "dependent";
  if (text.startsWith("self")) return "self";
  return null;
};

const sideOf = (value: string): Side => {
  const text = value.toLowerCase();
  if (text.startsWith("purchase")) return "buy";
  if (text.includes("partial")) return "partial_sale";
  if (text.startsWith("sale")) return "sell";
  if (text.startsWith("exchange")) return "exchange";
  return "unknown";
};

/** The transactions table of `/search/view/ptr/{uuid}/`: # | date | owner | ticker | asset | type | order | amount | comment. */
export function parseSenatePtr(html: string): SenateRow[] {
  const rows: SenateRow[] = [];
  const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  for (const tr of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      textOf(m[1]),
    );
    if (cells.length < 8) continue;
    const amount = parseAmount(cells[7]);
    const ticker = /^[A-Z][A-Z0-9.-]{0,6}$/.test(cells[3]) ? cells[3] : null;
    rows.push({
      transactedAt: usDate(cells[1]),
      notifiedAt: null,
      owner: ownerOf(cells[2]),
      ticker,
      asset: cells[4],
      assetType: cells[5] || null,
      side: sideOf(cells[6]),
      amountMin: amount?.min ?? null,
      amountMax: amount?.max ?? null,
      amountText: cells[7],
      note: cells[8] && cells[8] !== "--" ? cells[8].slice(0, 400) : null,
    });
  }
  return rows;
}

export const senateCsrf = (html: string) =>
  /name=["']csrfmiddlewaretoken["']\s+value=["']([^"']+)["']/.exec(html)?.[1] ??
  null;
