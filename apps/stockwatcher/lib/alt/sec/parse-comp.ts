import type { CompanyFacts, FactEntry } from "../../sec-data";
import type { ExecPay, PayVersusPerformance } from "./types";

const named: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  "&#160;": " ",
};

function decode(text: string) {
  return text
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#160);/g, (match) => named[match])
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    );
}

/** Cell text with line breaks kept, so a name and the title under it stay separable. */
function cellText(html: string) {
  return decode(
    html.replace(/<br\s*\/?>|<\/(?:p|div)>/gi, "\n").replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((line) => line.replace(/[\u200b\u00a0\ufeff\s]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const footnote = /^(\((?:\d{1,2}|[a-z])\)\s*)+$/i;
const spacer = /^[$)%]*$/;

function rowCells(row: string): string[] {
  return [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((match) => cellText(match[1]))
    .map((cell) => cell.replace(/^([\d,.]+)\s*(\(\d{1,2}\)\s*)+$/, "$1"))
    .filter((cell) => !spacer.test(cell) && !footnote.test(cell));
}

type Field =
  | "name"
  | "year"
  | "salary"
  | "bonus"
  | "stockAwards"
  | "optionAwards"
  | "nonEquityIncentive"
  | "other"
  | "total";

function fieldOf(header: string): Field | null {
  const text = header
    .toLowerCase()
    .replace(/\(\s*\d{1,2}\s*\)/g, "")
    .replace(/\s+/g, " ");
  if (/^(name|named|principal)/.test(text)) return "name";
  if (/^(fiscal )?year/.test(text)) return "year";
  if (/salary/.test(text)) return "salary";
  if (/bonus/.test(text)) return "bonus";
  if (/stock award/.test(text)) return "stockAwards";
  if (/option award/.test(text)) return "optionAwards";
  if (/non-?equity/.test(text)) return "nonEquityIncentive";
  if (/all other/.test(text)) return "other";
  if (/^total/.test(text)) return "total";
  return null;
}

const titleLike =
  /\b(chief|officer|president|chair(?:man|woman|person)?|ceo|cfo|coo|cto|counsel|secretary|treasurer|director|vice|executive|controller|principal)\b/i;

const blank = new Set(["", "—", "–", "-", "--", "n/a", "na", "$"]);

function money(cell: string): number | null | undefined {
  const text = cell.replace(/[$\s]/g, "");
  if (blank.has(text.toLowerCase())) return null;
  const negative = /^\(.*\)$/.test(text);
  const digits = text.replace(/^\(|\)$/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return undefined;
  return negative ? -Number(digits) : Number(digits);
}

export type SummaryTable = {
  parsed: boolean;
  rows: ExecPay[];
  note: string | null;
};

const moneyFields: Field[] = [
  "salary",
  "bonus",
  "stockAwards",
  "optionAwards",
  "nonEquityIncentive",
  "other",
  "total",
];

function parseTable(table: string): SummaryTable | null {
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
    (match) => rowCells(match[1]),
  );
  const headerAt = rows.findIndex(
    (cells) => cells.some((cell) => /salary/i.test(cell)) && cells.length >= 4,
  );
  if (headerAt < 0 || headerAt > 4) return null;
  let header = rows[headerAt];
  let first = headerAt + 1;
  if (!header.some((cell) => /^total/i.test(cell))) {
    header = [...header, ...(rows[first] ?? [])];
    first++;
  }
  const fields = header.map(fieldOf);
  if (
    !fields.includes("salary") ||
    !fields.includes("total") ||
    !fields.includes("year")
  )
    return null;
  const nameFirst = fields[0] === "name";
  const result: ExecPay[] = [];
  let skipped = 0;
  let current: { name: string; title: string | null } | null = null;

  for (const cells of rows.slice(first)) {
    if (!cells.length) continue;
    let values: string[];
    if (
      cells.length === fields.length &&
      nameFirst &&
      current &&
      titleLike.test(cells[0])
    ) {
      current.title ??= cells[0].replace(/\n/g, " ");
      values = cells.slice(1);
    } else if (cells.length === fields.length && nameFirst) {
      const [name, ...title] = cells[0].split("\n");
      current = { name, title: title.join(" ") || null };
      values = cells.slice(1);
    } else if (
      cells.length === fields.length - 1 &&
      /^\d{4}$/.test(cells[0]) &&
      current
    ) {
      values = cells;
    } else if (cells.length === 1 && nameFirst) {
      const [name, ...title] = cells[0].split("\n");
      current = { name, title: title.join(" ") || null };
      continue;
    } else {
      skipped++;
      continue;
    }
    const pay: ExecPay = {
      name: current?.name ?? "",
      title: current?.title ?? null,
      year: 0,
      salary: null,
      bonus: null,
      stockAwards: null,
      optionAwards: null,
      nonEquityIncentive: null,
      other: null,
      total: null,
    };
    let valid = true;
    fields.slice(nameFirst ? 1 : 0).forEach((field, index) => {
      const cell = values[index];
      if (!field || cell === undefined) return;
      if (field === "year") pay.year = Number(cell);
      else if (field !== "name") {
        const value = money(cell);
        if (value === undefined) valid = false;
        else pay[field] = value;
      }
    });
    if (
      !valid ||
      !current?.name ||
      !(pay.year >= 1990 && pay.year <= 2100) ||
      pay.total === null
    ) {
      skipped++;
      continue;
    }
    result.push(pay);
  }
  if (!result.length) return null;
  const titles = new Map<string, string>();
  for (const pay of result)
    if (pay.title && !titles.has(pay.name)) titles.set(pay.name, pay.title);
  return {
    parsed: true,
    rows: result.map((pay) => ({
      ...pay,
      title: pay.title ?? titles.get(pay.name) ?? null,
    })),
    note: skipped
      ? `${skipped} row${skipped === 1 ? "" : "s"} of the table could not be read and are omitted.`
      : null,
  };
}

/** Best effort: the first table whose headers read as the Summary Compensation Table. Rows that do not line up with the headers are dropped, never guessed. */
export function parseSummaryCompensation(html: string): SummaryTable {
  for (const [table] of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    if (!/salary/i.test(table) || !/total/i.test(table)) continue;
    const parsed = parseTable(table);
    if (parsed) return parsed;
  }
  return {
    parsed: false,
    rows: [],
    note: "No Summary Compensation Table could be read from the proxy.",
  };
}

const MS_DAY = 86_400_000;

function annualFact(
  facts: CompanyFacts,
  namespace: string,
  concept: string,
  end: string,
) {
  const entries = facts.facts[namespace]?.[concept]?.units.USD ?? [];
  const matches = entries.filter((entry: FactEntry) => {
    if (entry.end !== end || !entry.start) return false;
    const days = (Date.parse(entry.end) - Date.parse(entry.start)) / MS_DAY;
    return days > 350 && days < 380;
  });
  return matches.sort((a, b) => b.filed.localeCompare(a.filed))[0]?.val ?? null;
}

/** Pay-versus-performance rows from the proxy's `ecd` facts; single-PEO years only, since multi-PEO years are dimensional and absent from company facts. */
export function payVersusPerformance(
  facts: CompanyFacts,
): PayVersusPerformance[] {
  const ecd = facts.facts.ecd;
  if (!ecd) return [];
  const years = new Set<string>();
  for (const concept of ["PeoTotalCompAmt", "PeoActuallyPaidCompAmt"])
    for (const entry of ecd[concept]?.units.USD ?? [])
      if (entry.form.startsWith("DEF 14A")) years.add(entry.end);
  const pick = (concept: string, end: string, unit = "USD") =>
    (ecd[concept]?.units[unit] ?? [])
      .filter((entry) => entry.end === end && entry.form.startsWith("DEF 14A"))
      .sort((a, b) => b.filed.localeCompare(a.filed))[0]?.val ?? null;
  return [...years]
    .sort((a, b) => b.localeCompare(a))
    .map((end) => ({
      fiscalYearEnd: end,
      peoTotal: pick("PeoTotalCompAmt", end),
      peoActuallyPaid: pick("PeoActuallyPaidCompAmt", end),
      neoAverageTotal: pick("NonPeoNeoAvgTotalCompAmt", end),
      neoAverageActuallyPaid: pick("NonPeoNeoAvgCompActuallyPaidAmt", end),
      totalShareholderReturn: pick("TotalShareholderRtnAmt", end),
      peerTotalShareholderReturn: pick("PeerGroupTotalShareholderRtnAmt", end),
      netIncome: annualFact(facts, "us-gaap", "NetIncomeLoss", end),
    }));
}
