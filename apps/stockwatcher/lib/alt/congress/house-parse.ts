import type { Holding, Owner, Side } from "./types";

export type HouseIndexEntry = {
  prefix: string;
  last: string;
  first: string;
  suffix: string;
  type: string;
  stateDst: string;
  year: number;
  filedAt: string;
  docId: string;
};

const entities: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};
const unescapeXml = (value: string) =>
  value.replace(
    /&(amp|lt|gt|quot|apos);/g,
    (match) => entities[match] ?? match,
  );

export const usDate = (value: string): string | null => {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
};

/** The Clerk's `{YEAR}FD.xml`: one `<Member>` per filing. */
export function parseHouseIndex(xml: string): HouseIndexEntry[] {
  const out: HouseIndexEntry[] = [];
  for (const block of xml.matchAll(/<Member>([\s\S]*?)<\/Member>/g)) {
    const field = (name: string) => {
      const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(block[1]);
      return match ? unescapeXml(match[1]).trim() : "";
    };
    const docId = field("DocID");
    const filedAt = usDate(field("FilingDate"));
    const year = Number(field("Year"));
    if (!docId || !filedAt || !Number.isFinite(year)) continue;
    out.push({
      prefix: field("Prefix"),
      last: field("Last"),
      first: field("First"),
      suffix: field("Suffix"),
      type: field("FilingType"),
      stateDst: field("StateDst"),
      year,
      filedAt,
      docId,
    });
  }
  return out;
}

export type ParsedAmount = { min: number | null; max: number | null };

const dollars = (value: string) => Number(value.replace(/[$,\s]/g, ""));

export function parseAmount(text: string): ParsedAmount | null {
  const range = /\$\s*([\d,]+)\s*-\s*\$\s*([\d,]+)/.exec(text);
  if (range) return { min: dollars(range[1]), max: dollars(range[2]) };
  const over = /Over\s+\$\s*([\d,]+)/i.exec(text);
  if (over) return { min: dollars(over[1]), max: null };
  return null;
}

export type RawTrade = {
  owner: Owner | null;
  asset: string;
  ticker: string | null;
  assetType: string | null;
  side: Side;
  transactedAt: string | null;
  notifiedAt: string | null;
  amountMin: number | null;
  amountMax: number | null;
  amountText: string;
  note: string | null;
};

const ownerCode: Record<string, Owner> = {
  SP: "spouse",
  JT: "joint",
  DC: "dependent",
};
const ownerPattern = /^(SP|JT|DC)\s+(.*)$/;
const chrome = [
  /^Filing ID #\d+$/,
  /^ID Owner Asset Transaction$/,
  /^Type$/,
  /^Date Notification$/,
  /^Date$/,
  /^Amount Cap\.$/,
  /^Gains >$/,
  /^\$200\?$/,
  /^(Name|Status|State\/District):/,
  /^Clerk of the House of Representatives/,
  /^[A-Z](?:\s+[A-Z]){0,5}$/,
];
const metadata = /^(F\s*S|S\s*O|D|C|L)\s*:/;
const rowPattern =
  /^(.*?)\s*\b(P|S|E|S \(partial\))\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.*)$/;
const sideOf: Record<string, Side> = {
  P: "buy",
  S: "sell",
  E: "exchange",
  "S (partial)": "partial_sale",
};

/** Splits "Name (TICK) [ST]" into its parts; the ticker is the parenthesis right before the type code. */
export function splitAsset(text: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  const code = /\[([A-Z]{2})\]\s*$/.exec(flat);
  const body = code ? flat.slice(0, code.index).trim() : flat;
  const tick = /\(([A-Z][A-Z0-9.-]{0,6})\)\s*$/.exec(body);
  const name = (tick ? body.slice(0, tick.index) : body).trim();
  return {
    asset: name.replace(/\s+-\s*$/, ""),
    ticker: tick ? tick[1] : null,
    assetType: code ? code[1] : null,
  };
}

const clean = (text: string) =>
  text
    .replaceAll("\u0000", "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !chrome.some((pattern) => pattern.test(line)));

export type PtrParse =
  | { parsed: true; trades: RawTrade[] }
  | { parsed: false; reason: string };

/**
 * Parses an e-filed House periodic transaction report from its extracted text.
 * Scanned paper filings have no text layer and come back `parsed: false`.
 */
export function parsePtrText(text: string): PtrParse {
  const rows = clean(text);
  if (rows.join("").length < 200 || !/Filing ID #\d+/.test(text))
    return { parsed: false, reason: "scanned filing, no text layer" };
  const trades: RawTrade[] = [];
  let buffer: string[] = [];
  let continuing = false;
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    const row = rowPattern.exec(line);
    if (row) {
      let tail = row[5];
      const overflow: string[] = [];
      if (/-\s*$/.test(tail)) {
        for (let j = i + 1; j < Math.min(rows.length, i + 4); j++) {
          if (/^\$[\d,]+\s*$/.test(rows[j])) {
            tail = `${tail} ${rows[j]}`;
            i = j;
            break;
          }
          if (metadata.test(rows[j]) || rowPattern.test(rows[j])) break;
          overflow.push(rows[j]);
        }
      }
      const exact = /^\$([\d,]+(?:\.\d+)?)\s*$/.exec(tail.trim());
      const amount =
        parseAmount(tail) ??
        (exact ? { min: dollars(exact[1]), max: dollars(exact[1]) } : null);
      let assetLines = (row[1] ? [...buffer, row[1]] : buffer).slice(-4);
      const ownerAt = assetLines.findLastIndex((l) => ownerPattern.test(l));
      if (ownerAt >= 0) assetLines = assetLines.slice(ownerAt);
      let owner: Owner | null = null;
      const first = ownerPattern.exec(assetLines[0] ?? "");
      if (first) {
        owner = ownerCode[first[1]];
        assetLines = [first[2], ...assetLines.slice(1)];
      }
      const asset = splitAsset([...assetLines, ...overflow].join(" "));
      if (asset.asset) {
        trades.push({
          owner,
          ...asset,
          side: sideOf[row[2]],
          transactedAt: usDate(row[3]),
          notifiedAt: usDate(row[4]),
          amountMin: amount?.min ?? null,
          amountMax: amount?.max ?? null,
          amountText: (amount ? tail.replace(/\s+/g, " ") : tail).trim(),
          note: null,
        });
      }
      buffer = [];
      continuing = false;
      continue;
    }
    if (continuing) {
      appendNote(trades, line);
      continuing = line.length >= 100;
      continue;
    }
    const meta = metadata.exec(line);
    if (meta) {
      buffer = [];
      if (meta[1] === "D" || meta[1] === "C") {
        appendNote(trades, line.replace(metadata, "").trim());
        continuing = line.length >= 100;
      }
      continue;
    }
    if (line.startsWith("*")) {
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  if (!trades.length)
    return { parsed: false, reason: "no transaction rows recognised" };
  return { parsed: true, trades };
}

function appendNote(trades: RawTrade[], text: string) {
  const last = trades.at(-1);
  if (!last || !text) return;
  last.note = `${last.note ? `${last.note} ` : ""}${text}`.slice(0, 400);
}

export type AnnualParse = {
  holdings: Holding[];
  assetsMid: number | null;
  assetsLow: number | null;
  assetsHigh: number | null;
  liabilitiesMid: number | null;
  flags: string[];
};

const midpoint = (min: number, max: number | null) =>
  max == null ? min : (min + max) / 2;

const rangePattern = /\$\s*([\d,]+)\s*-\s*\$\s*([\d,]+)|Over\s+\$\s*([\d,]+)/g;

function sumRanges(text: string) {
  let mid = 0;
  let count = 0;
  for (const match of text.matchAll(rangePattern)) {
    count++;
    mid += match[3]
      ? midpoint(dollars(match[3]), null)
      : midpoint(dollars(match[1]), dollars(match[2]));
  }
  return { mid, count };
}

/**
 * Best-effort read of an e-filed House annual report: Schedule A assets
 * (value ranges) and Schedule D liabilities. Values stay ranges; anything
 * the text layout hides is flagged rather than guessed.
 */
export function parseAnnualText(text: string): AnnualParse | null {
  const lines = clean(text).filter(
    (line) =>
      !/^Asset Owner Value of Asset/.test(line) &&
      !/^\$1,000\?$/.test(line) &&
      !/^Owner Creditor Date Incurred/.test(line),
  );
  const at = (pattern: RegExp, from = 0) =>
    lines.findIndex((line, index) => index >= from && pattern.test(line));
  const a = at(/^S\s*A\s*:/);
  if (a < 0) return null;
  const b = at(/^S\s*B\s*:/, a + 1);
  const d = at(/^S\s*D\s*:/, a + 1);
  const e = d < 0 ? -1 : at(/^S\s*E\s*:/, d + 1);
  const assetLines = lines.slice(a + 1, b < 0 ? lines.length : b);
  const flags: string[] = [];
  const holdings: Holding[] = [];
  const valuePattern =
    /^(?:(SP|JT|DC)\s+)?(\$\s*[\d,]+\s*-\s*\$\s*[\d,]+|Over\s+\$\s*[\d,]+|None\b)/;
  const tail =
    /\$\s*[\d,]+|^(L|D)\s*:|^(None|Dividends|Interest|Capital|Rent|Royalt|Partnership|Tax|Excepted|Other|Income|Business|Farm|Ordinary|Qualified)/;
  for (let i = 0; i < assetLines.length; i++) {
    const code = /^(.*?)\[([A-Z]{2})\]\s*(.*)$/.exec(assetLines[i]);
    if (!code) continue;
    let name = code[1].trim();
    const previous = assetLines[i - 1];
    if (previous && !tail.test(previous) && !/\[[A-Z]{2}\]/.test(previous))
      name = `${previous} ${name}`.trim();
    const window = [code[3], assetLines[i + 1] ?? "", assetLines[i + 2] ?? ""]
      .join(" ")
      .trim();
    const value = valuePattern.exec(window);
    const amount = value
      ? value[2] === "None"
        ? { min: 0, max: 0 }
        : parseAmount(value[2])
      : null;
    holdings.push({
      ...(({ asset, ticker }) => ({ asset, ticker }))(
        splitAsset(`${name} [${code[2]}]`),
      ),
      assetType: code[2],
      owner: value?.[1] ? ownerCode[value[1]] : null,
      valueMin: amount?.min ?? null,
      valueMax: amount ? amount.max : null,
      valueText: value ? value[2].replace(/\s+/g, " ") : "",
    });
  }
  const valued = holdings.filter((h) => h.valueMin != null);
  if (!holdings.length && !assetLines.some((l) => /None disclosed/i.test(l)))
    flags.push("no assets recognised");
  if (valued.length < holdings.length)
    flags.push(
      `${holdings.length - valued.length} assets without a readable value`,
    );
  const liabilityText =
    d < 0 ? "" : lines.slice(d + 1, e < 0 ? lines.length : e).join(" ");
  if (d < 0) flags.push("liabilities section not found");
  const liabilities = sumRanges(liabilityText);
  const open = valued.some((h) => h.valueMax == null);
  return {
    holdings,
    assetsMid: valued.reduce(
      (sum, h) => sum + midpoint(h.valueMin ?? 0, h.valueMax),
      0,
    ),
    assetsLow: valued.reduce((sum, h) => sum + (h.valueMin ?? 0), 0),
    assetsHigh: open
      ? null
      : valued.reduce((sum, h) => sum + (h.valueMax ?? 0), 0),
    liabilitiesMid: d < 0 ? null : liabilities.mid,
    flags,
  };
}
