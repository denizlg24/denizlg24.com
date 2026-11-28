import type { Side } from "./types";

export type OgeListing = {
  name: string;
  /** "278 Transaction" for OGE Form 278-T, otherwise the document label ("Annual (2026)"). */
  label: string;
  url: string;
  filedAt: string;
  amended: boolean;
};

export type OgeRow = {
  asset: string;
  side: Side;
  transactedAt: string | null;
  amountMin: number | null;
  amountMax: number | null;
  amountText: string;
};

export function parseOgeListing(row: {
  name: string;
  type: string;
  docDate: string;
  amended?: string;
}): OgeListing | null {
  const link = /<a href='([^']+)'[^>]*>([^<]+)<\/a>/.exec(row.type);
  if (!link) return null;
  return {
    name: row.name.trim(),
    label: link[2].trim(),
    url: link[1],
    filedAt: row.docDate.slice(0, 10),
    amended: /amended/i.test(row.type) || Boolean(row.amended),
  };
}

const ranges: [number, number | null][] = [
  [1_001, 15_000],
  [15_001, 50_000],
  [50_001, 100_000],
  [100_001, 250_000],
  [250_001, 500_000],
  [500_001, 1_000_000],
  [1_000_001, 5_000_000],
  [5_000_001, 25_000_000],
  [25_000_001, 50_000_000],
  [50_000_001, null],
];

const digits = (text: string) =>
  Number(
    text
      .replace(/[DOo]/g, "0")
      .replace(/[lI|]/g, "1")
      .replace(/[^0-9]/g, "") || Number.NaN,
  );

/** OCR garbles digits; accept an amount only when it snaps to one of OGE's fixed ranges. */
export function snapOgeAmount(text: string) {
  const parts = text.split(/\s*[-•–—]\s*/);
  const low = digits(parts[0] ?? "");
  const high = parts[1] ? digits(parts[1]) : Number.NaN;
  const hit =
    ranges.find(([min]) => min === low) ??
    ranges.find(([, max]) => max != null && max === high);
  if (!hit) return null;
  return {
    min: hit[0],
    max: hit[1],
    text:
      hit[1] == null
        ? `Over $${(hit[0] - 1).toLocaleString("en-US")}`
        : `$${hit[0].toLocaleString("en-US")} - $${hit[1].toLocaleString("en-US")}`,
  };
}

const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/**
 * Rebuilds a transaction date from OCR text like "9/2312026" (the slash read
 * as a "1"). Returns a date only when exactly one reading falls in the 120
 * days before the filing; otherwise null.
 */
export function ogeDate(token: string, filedAt: string): string | null {
  const year =
    /(20\d\d)$/.exec(token)?.[1] ??
    (/(0\d\d)$/.test(token) ? `2${token.slice(-3)}` : null);
  if (!year) return null;
  const body = token.slice(0, token.length - (/(20\d\d)$/.test(token) ? 4 : 3));
  const core = body.replace(/[^0-9/]$/, "").replace(/[/1l|]$/, "");
  const candidates = new Set<string>();
  const add = (month: number, day: number) => {
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31)
      candidates.add(iso(Number(year), month, day));
  };
  if (core.includes("/")) {
    const [m, d] = core.split("/");
    add(Number(m), Number(d));
  } else {
    const flat = core.replace(/[^0-9]/g, "");
    for (let k = 1; k < flat.length; k++) {
      add(Number(flat.slice(0, k)), Number(flat.slice(k)));
      if (flat[k] === "1")
        add(Number(flat.slice(0, k)), Number(flat.slice(k + 1)));
    }
  }
  const end = Date.parse(filedAt);
  const inWindow = [...candidates].filter((date) => {
    const time = Date.parse(date);
    return time <= end && end - time <= 120 * 86_400_000;
  });
  return inWindow.length === 1 ? inWindow[0] : null;
}

const classify = (token: string, line: string): Side | null => {
  if (/exch/i.test(token)) return "exchange";
  if (/sal[eo]|sa1e|sell/i.test(token))
    return /partial/i.test(line) ? "partial_sale" : "sell";
  if (/rcha|rchas|urch|chase|chaso|chasc/i.test(token)) return "buy";
  return null;
};

export type OgeParse = { rows: OgeRow[]; skipped: number };

/** Parses the OCR text layer of an OGE 278-T. Rows whose type or amount cannot be read are counted, not guessed. */
export function parseOgeText(text: string, filedAt: string): OgeParse {
  const rows: OgeRow[] = [];
  let skipped = 0;
  for (const raw of text.replaceAll("\u0000", "").split(/\r?\n/)) {
    const line = raw.trim();
    const lead = /^(\d{1,3})\s+(.+)$/.exec(line);
    if (!lead) continue;
    const tokens = lead[2].split(/\s+/);
    const dateAt = tokens.findIndex(
      (token, index) =>
        index >= 2 &&
        /^[\w/"'•|.]{5,12}$/.test(token) &&
        /02[0-9]$/.test(token),
    );
    if (dateAt < 0) continue;
    const side = classify(tokens[dateAt - 1], line);
    const afterDate = tokens.slice(dateAt + 1);
    if (/^(yes|yos|no|nu|nn)$/i.test(afterDate[0] ?? "")) afterDate.shift();
    const amount = snapOgeAmount(afterDate.join(" "));
    if (!side || !amount) {
      skipped++;
      continue;
    }
    const name = tokens
      .slice(0, dateAt - 1)
      .join(" ")
      .replace(/\s+[^A-Za-z0-9]?[A-Za-z]?$/, "")
      .replace(/^!/, "I")
      .trim();
    if (!name) {
      skipped++;
      continue;
    }
    rows.push({
      asset: name,
      side,
      transactedAt: ogeDate(tokens[dateAt], filedAt),
      amountMin: amount.min,
      amountMax: amount.max,
      amountText: amount.text,
    });
  }
  return { rows, skipped };
}
