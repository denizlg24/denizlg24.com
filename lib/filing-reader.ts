import "server-only";
import { archive, sec, submission } from "@/lib/research";
import { lookupCik, secFetch } from "@/lib/sec-data";
import {
  findSections,
  htmlToText,
  layoutFor,
  resolveSection,
  searchPassages,
  sliceBudget,
  type FilingSection,
  type Passage,
} from "@/lib/filing-text";

const READ_BUDGET = 13_000;
const MAX_DOCUMENT_BYTES = 30_000_000;
const MAX_EXHIBIT_CHARS = 300_000;
const DOC_TTL_MS = 1_800_000;
const MAX_DOCS = 6;

type FilingRow = {
  accession: string;
  form: string;
  filed: string;
  report: string;
  document: string;
};

type Recent = {
  form: string[];
  primaryDocument: string[];
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
};

const rowsOf = (recent: Recent): FilingRow[] =>
  recent.form.map((form, index) => ({
    form,
    accession: recent.accessionNumber[index],
    filed: recent.filingDate[index],
    report: recent.reportDate[index],
    document: recent.primaryDocument[index],
  }));

async function findFiling(cik: string, form: string, which: string) {
  const record = await submission(cik);
  const wantsLatest = which === "latest";
  const matches = (row: FilingRow) =>
    row.form === form &&
    (wantsLatest ||
      row.accession === which ||
      row.accession.replaceAll("-", "") === which.replaceAll("-", "") ||
      row.filed === which ||
      row.report === which);
  let found = rowsOf(record.filings.recent).find(matches);
  for (const file of record.filings.files?.slice(0, 4) ?? []) {
    if (found) break;
    if (!/^CIK\d+-submissions-\d+\.json$/.test(file.name)) continue;
    found = rowsOf(await sec<Recent>("data.sec.gov", `/submissions/${file.name}`)).find(matches);
  }
  if (!found)
    throw new Error(
      wantsLatest
        ? `No ${form} filing found for this company.`
        : `No ${form} filing matching "${which}" was found.`,
    );
  return { company: record.name, row: found };
}

const urlOf = (cik: string, accession: string, document: string) =>
  `https://www.sec.gov${archive(cik, accession)}/${document}`;

async function documentText(url: string, maxChars?: number) {
  const response = await secFetch(url, {
    timeoutMs: 45_000,
    maxBytes: MAX_DOCUMENT_BYTES,
  });
  const text = htmlToText(await response.text());
  return maxChars ? text.slice(0, maxChars) : text;
}

async function exhibit991(cik: string, accession: string) {
  const listing = await secFetch(
    `https://www.sec.gov${archive(cik, accession)}/${accession}-index.html`,
  );
  for (const row of (await listing.text()).split(/<tr\b/i)) {
    if (!/>\s*EX-99\.1\s*</i.test(row)) continue;
    const link = /href="[^"]*?([^"/]+\.html?)"/i.exec(row);
    if (link) return urlOf(cik, accession, link[1]);
  }
  return null;
}

type ParsedFiling = {
  at: number;
  text: string;
  sections: FilingSection[];
  exhibitUrl: string | null;
};

const parsed = new Map<string, ParsedFiling>();

async function parseFiling(cik: string, row: FilingRow): Promise<ParsedFiling> {
  const key = row.accession;
  const hit = parsed.get(key);
  if (hit && Date.now() - hit.at < DOC_TTL_MS) return hit;
  const layout = layoutFor(row.form);
  let text = await documentText(urlOf(cik, row.accession, row.document));
  let exhibitUrl: string | null = null;
  if (layout === "events") {
    exhibitUrl = await exhibit991(cik, row.accession).catch(() => null);
    if (exhibitUrl) {
      const body = await documentText(exhibitUrl, MAX_EXHIBIT_CHARS).catch(() => "");
      if (body) text += `\nEXHIBIT 99.1\n${body}`;
    }
  }
  if (text.length < 200)
    throw new Error("The filing document has no readable text.");
  const entry = {
    at: Date.now(),
    text,
    sections: findSections(text, layout, row.form),
    exhibitUrl,
  };
  parsed.delete(key);
  parsed.set(key, entry);
  for (const oldest of parsed.keys()) {
    if (parsed.size <= MAX_DOCS) break;
    parsed.delete(oldest);
  }
  return entry;
}

export type FilingRead = {
  symbol: string;
  company: string;
  form: string;
  filed: string;
  period: string | null;
  accession: string;
  url: string;
  exhibitUrl: string | null;
  sections: Array<{ id: string; title: string; chars: number }>;
  section: { id: string; title: string; chars: number } | null;
  offset: number;
  nextOffset: number | null;
  totalChars: number;
  text: string | null;
  passages: Passage[] | null;
  notice: string | null;
};

export async function readFiling(input: {
  symbol: string;
  form: string;
  which: string;
  section?: string;
  query?: string;
  offset: number;
}): Promise<FilingRead> {
  const company = await lookupCik(input.symbol);
  if (!company)
    throw new Error(
      `${input.symbol} is not an SEC registrant; filings are only available for US-listed filers.`,
    );
  const form = input.form.trim().toUpperCase();
  const { company: name, row } = await findFiling(company.cik, form, input.which.trim());
  const filing = await parseFiling(company.cik, row);
  const listed = filing.sections.map((item) => ({
    id: item.id,
    title: item.title,
    chars: item.end - item.start,
  }));
  const base = {
    symbol: input.symbol,
    company: name,
    form: row.form,
    filed: row.filed,
    period: row.report || null,
    accession: row.accession,
    url: urlOf(company.cik, row.accession, row.document),
    exhibitUrl: filing.exhibitUrl,
    sections: listed,
    totalChars: filing.text.length,
  };

  let notice: string | null = null;
  let picked: FilingSection | undefined;
  if (input.section) {
    picked = resolveSection(filing.sections, input.section, row.form);
    if (!picked && !input.query) {
      notice = `No section matched "${input.section}"; showing the best passages for it instead. Available sections are listed.`;
    }
  }
  const firstEvent = layoutFor(row.form) === "events" ? filing.sections[0] : undefined;
  const scope = picked
    ? { start: picked.start, end: picked.end }
    : { start: firstEvent?.start ?? 0, end: filing.text.length };
  const searchTerm = input.query ?? (input.section && !picked ? input.section : undefined);

  if (searchTerm) {
    const body = filing.text.slice(scope.start, scope.end);
    const passages = searchPassages(body, scope.start, searchTerm, READ_BUDGET);
    return {
      ...base,
      section: picked ? { id: picked.id, title: picked.title, chars: scope.end - scope.start } : null,
      offset: 0,
      nextOffset: null,
      text: null,
      passages,
      notice:
        notice ?? (passages.length === 0 ? `No passages matched "${searchTerm}".` : null),
    };
  }

  const startAt = scope.start + Math.min(input.offset, scope.end - scope.start);
  const window = filing.text.slice(0, scope.end);
  const chunk = sliceBudget(window, startAt, READ_BUDGET);
  return {
    ...base,
    section: picked ? { id: picked.id, title: picked.title, chars: scope.end - scope.start } : null,
    offset: startAt - scope.start,
    nextOffset: chunk.next === null ? null : chunk.next - scope.start,
    text: chunk.text,
    passages: null,
    notice:
      !picked && !firstEvent && filing.sections.length > 0
        ? "No section chosen: this is the start of the document. Pick a section id from the list."
        : null,
  };
}
