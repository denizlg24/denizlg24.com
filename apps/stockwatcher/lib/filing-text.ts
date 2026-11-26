export type FilingSection = {
  id: string;
  title: string;
  start: number;
  end: number;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  bull: "-",
  hellip: "...",
  reg: "(R)",
  trade: "(TM)",
  copy: "(C)",
};

const decodeEntities = (text: string) =>
  text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : " ";
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });

const CELL = "\u0001";

function flattenRow(line: string) {
  const cells = line
    .split(CELL)
    .map((cell) => cell.replace(/[\s ​]+/g, " ").trim())
    .filter(Boolean);
  const merged: string[] = [];
  for (const cell of cells) {
    const last = merged.length - 1;
    if (last >= 0 && /^[)%]+$/.test(cell)) merged[last] += cell;
    else if (last >= 0 && /^[$(]+$/.test(merged[last])) merged[last] += cell;
    else merged.push(cell);
  }
  return merged.join(" | ");
}

export function htmlToText(html: string) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, "")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)\s*>/gi, CELL)
    .replace(
      /<\/(p|div|h[1-6]|li|tr|table|ul|ol|section|blockquote|pre)\s*>/gi,
      "\n",
    )
    .replace(/<(p|div|h[1-6]|li|tr|table|pre)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const lines: string[] = [];
  for (const raw of decodeEntities(stripped).split("\n")) {
    const line = flattenRow(raw);
    if (line && !/^\d{1,3}$/.test(line) && !/^[-_=| ]+$/.test(line))
      lines.push(line);
  }
  return lines.join("\n");
}

type Layout = "items" | "events" | "plain";

const ITEM_ID = String.raw`(\d{1,2}(?:\.?[A-E])?)(?![A-Za-z0-9])`;
const itemLine = new RegExp(
  String.raw`^(?:[Pp][Aa][Rr][Tt]\s+[IVX]+[\s,.:|-]*)?(?:Item|ITEM)\s+${ITEM_ID}[\s.:|–—-]*(.*)$`,
);
const eventLine = /^(?:Item|ITEM)\s+(\d\.\d{2})(?![\d])[\s.:|–—-]*(.*)$/;
const partLine = /^[Pp][Aa][Rr][Tt]\s+(IV|I{1,3})\b/i;
const exhibitLine = /^EXHIBIT (99\.\d+)$/;

export const layoutFor = (form: string): Layout => {
  const base = form.replace(/\/A$/, "");
  if (base === "8-K") return "events";
  if (/^(10-K|10-KT|10-Q|20-F|40-F)$/.test(base)) return "items";
  return "plain";
};

const ANNUAL_TITLES: Record<string, string> = {
  "1": "Business",
  "1A": "Risk Factors",
  "1B": "Unresolved Staff Comments",
  "1C": "Cybersecurity",
  "2": "Properties",
  "3": "Legal Proceedings",
  "4": "Mine Safety Disclosures",
  "5": "Market for Registrant's Common Equity",
  "6": "Reserved",
  "7": "Management's Discussion and Analysis",
  "7A": "Quantitative and Qualitative Disclosures About Market Risk",
  "8": "Financial Statements and Supplementary Data",
  "9": "Changes in and Disagreements With Accountants",
  "9A": "Controls and Procedures",
  "9B": "Other Information",
  "9C": "Foreign Jurisdictions That Prevent Inspections",
  "10": "Directors, Executive Officers and Corporate Governance",
  "11": "Executive Compensation",
  "12": "Security Ownership",
  "13": "Relationships, Related Transactions and Director Independence",
  "14": "Principal Accountant Fees and Services",
  "15": "Exhibits and Financial Statement Schedules",
  "16": "Form 10-K Summary",
};

const startsLowercase = (rest: string) => /^[a-z]/.test(rest);

function plainHeadings(lines: string[], offsets: number[]) {
  const found: Array<{ id: string; title: string; start: number }> = [];
  lines.forEach((line, index) => {
    if (line.length < 5 || line.length > 90 || line.includes(" | ")) return;
    const letters = line.replace(/[^A-Za-z]/g, "");
    if (letters.length < 5) return;
    const upper = line.replace(/[^A-Z]/g, "").length;
    if (upper / letters.length < 0.85 || /[.:;,]$/.test(line)) return;
    found.push({
      id: line
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
      title: line,
      start: offsets[index],
    });
  });
  return found;
}

export function findSections(text: string, layout: Layout, form: string) {
  const lines = text.split("\n");
  const offsets: number[] = [];
  let position = 0;
  for (const line of lines) {
    offsets.push(position);
    position += line.length + 1;
  }
  const quarterly = form.replace(/\/A$/, "") === "10-Q";
  const headings: Array<{ id: string; title: string; start: number }> = [];
  if (layout === "plain") headings.push(...plainHeadings(lines, offsets));
  else {
    let part = "";
    lines.forEach((line, index) => {
      if (line.length > 250) return;
      if (layout === "items" && quarterly) {
        const partMatch = partLine.exec(line);
        if (partMatch && line.length < 60) part = partMatch[1].toUpperCase();
      }
      const exhibit = exhibitLine.exec(line);
      if (exhibit && layout === "events") {
        headings.push({
          id: exhibit[1],
          title: `Exhibit ${exhibit[1]}`,
          start: offsets[index],
        });
        return;
      }
      const match = (layout === "events" ? eventLine : itemLine).exec(line);
      if (!match) return;
      let title = match[2].replace(/^[\s|.:-]+/, "").trim();
      if (startsLowercase(title)) return;
      if (!title && index + 1 < lines.length) {
        const next = lines[index + 1];
        if (next.length < 120 && !/^(Item|ITEM|PART|Part)\b/.test(next))
          title = next.replace(/\s*\|.*$/, "").trim();
      }
      const item = match[1].replace(".", "").toUpperCase();
      if (/^[,\d]/.test(title)) title = "";
      if (layout === "items" && /^10-K/.test(form))
        title = ANNUAL_TITLES[item] ?? title;
      headings.push({
        id:
          layout === "items" && quarterly && part
            ? `${part}-${item}`
            : layout === "events"
              ? match[1]
              : item,
        title,
        start: offsets[index],
      });
    });
  }
  // Running page headers repeat "Item 1A" at every page break: fold them into the section.
  const distinct: typeof headings = [];
  for (const heading of headings) {
    const previous = distinct.at(-1);
    if (previous?.id !== heading.id) distinct.push(heading);
    else if (!previous.title) previous.title = heading.title;
  }
  const spans = distinct.map((heading, index) => ({
    ...heading,
    end: distinct[index + 1]?.start ?? text.length,
  }));
  const candidates = new Map<string, FilingSection[]>();
  for (const span of spans)
    candidates.set(span.id, [...(candidates.get(span.id) ?? []), span]);
  const ordered = layout === "items" && !quarterly;
  const rank = (id: string) =>
    Number.parseInt(id, 10) * 10 +
    (id.match(/[A-E]$/)?.[0].charCodeAt(0) ?? 64) -
    64;
  const ids = ordered
    ? [...candidates.keys()].toSorted((a, b) => rank(a) - rank(b))
    : [...candidates.keys()];
  const longest = new Map<string, FilingSection>();
  let floor = 0;
  for (const id of ids) {
    const best = (candidates.get(id) ?? [])
      .filter((span) => !ordered || span.start >= floor)
      .toSorted((a, b) => b.end - b.start - (a.end - a.start))[0];
    if (!best) continue;
    longest.set(id, best);
    floor = best.start;
  }
  const minimum = layout === "plain" ? 1500 : 0;
  return [...longest.values()]
    .filter((section) => section.end - section.start >= minimum)
    .sort((a, b) => a.start - b.start)
    .slice(0, 60);
}

const SYNONYMS: Array<{
  pattern: RegExp;
  annual: string;
  quarterly: string;
  foreign: string;
}> = [
  { pattern: /risk factor/, annual: "1A", quarterly: "II-1A", foreign: "3D" },
  {
    pattern:
      /md&a|management.?s discussion|liquidity and capital|results of operations|operating and financial review/,
    annual: "7",
    quarterly: "I-2",
    foreign: "5",
  },
  {
    pattern: /^business$|^overview$/,
    annual: "1",
    quarterly: "",
    foreign: "4",
  },
  {
    pattern: /financial statements|balance sheet|income statement/,
    annual: "8",
    quarterly: "I-1",
    foreign: "18",
  },
  {
    pattern: /legal proceeding|litigation/,
    annual: "3",
    quarterly: "II-1",
    foreign: "8A",
  },
  { pattern: /propert/, annual: "2", quarterly: "", foreign: "4D" },
  { pattern: /market risk/, annual: "7A", quarterly: "I-3", foreign: "11" },
  {
    pattern: /controls and procedures|internal control/,
    annual: "9A",
    quarterly: "I-4",
    foreign: "15",
  },
  {
    pattern: /executive compensation/,
    annual: "11",
    quarterly: "",
    foreign: "6B",
  },
  { pattern: /cybersecurity/, annual: "1C", quarterly: "", foreign: "16K" },
  { pattern: /unresolved staff/, annual: "1B", quarterly: "", foreign: "4A" },
  {
    pattern:
      /market for (the )?registrant|common equity|share repurchase|issuer purchases/,
    annual: "5",
    quarterly: "II-2",
    foreign: "9",
  },
];

export function resolveSection(
  sections: FilingSection[],
  request: string,
  form: string,
) {
  const wanted = request.trim();
  const lowered = wanted.toLowerCase();
  const byId = (id: string) =>
    sections.find((section) => section.id.toLowerCase() === id.toLowerCase());

  const idMatch =
    /^(?:part\s+(iv|i{1,3})[\s,.-]*)?(?:item\s*)?(\d{1,2}(?:\.\d{2}|\.?[a-e])?)$/i.exec(
      lowered,
    );
  if (idMatch) {
    const part = idMatch[1]?.toUpperCase();
    const item = idMatch[2]
      .replace(/^(\d{1,2})\.([a-e])$/i, "$1$2")
      .toUpperCase();
    const found =
      byId(part ? `${part}-${item}` : item) ??
      (form.replace(/\/A$/, "") === "10-Q"
        ? (byId(`I-${item}`) ?? byId(`II-${item}`))
        : undefined);
    if (found) return found;
  }
  const exhibit = /^(?:ex(?:hibit)?\.?\s*)?(99\.\d+)$/i.exec(lowered);
  if (exhibit) return byId(exhibit[1]);
  if (lowered === "exhibit" || lowered === "press release") return byId("99.1");

  const base = form.replace(/\/A$/, "");
  const kind =
    base === "10-Q"
      ? "quarterly"
      : /^(20-F|40-F)$/.test(base)
        ? "foreign"
        : "annual";
  if (/^(10-K|10-KT|10-Q|20-F|40-F)$/.test(base))
    for (const synonym of SYNONYMS)
      if (synonym.pattern.test(lowered)) {
        const target = synonym[kind];
        const found = target
          ? (byId(target) ?? byId(target.replace(/\D+$/, "")))
          : undefined;
        if (found) return found;
      }
  return (
    sections.find((section) => section.title.toLowerCase() === lowered) ??
    sections.find((section) => section.title.toLowerCase().includes(lowered))
  );
}

export function sliceBudget(text: string, offset: number, limit: number) {
  const hardEnd = Math.min(text.length, offset + limit);
  if (hardEnd >= text.length) return { text: text.slice(offset), next: null };
  const lineBreak = text.lastIndexOf("\n", hardEnd);
  const end = lineBreak > offset + limit * 0.6 ? lineBreak : hardEnd;
  return {
    text: text.slice(offset, end),
    next: end + (text[end] === "\n" ? 1 : 0),
  };
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "from",
  "this",
  "are",
  "was",
  "were",
  "has",
  "have",
  "its",
  "our",
  "their",
  "than",
  "into",
  "about",
  "what",
  "which",
  "how",
  "does",
  "did",
  "any",
  "all",
]);

export type Passage = { offset: number; text: string; score: number };

export function searchPassages(
  text: string,
  base: number,
  query: string,
  limit: number,
  maxPassages = 6,
) {
  const terms = [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9&%.$-]+/)
        .map((term) => term.replace(/^[.-]+|[.-]+$/g, ""))
        .filter((term) => term.length >= 3 && !STOPWORDS.has(term)),
    ),
  ];
  if (terms.length === 0) return [];
  const phrase = query.trim().toLowerCase();
  const chunks: Array<{ start: number; end: number; score: number }> = [];
  let start = 0;
  let cursor = 0;
  const lines = text.split("\n");
  for (const line of lines) {
    cursor += line.length + 1;
    if (cursor - start >= 700) {
      chunks.push({ start, end: Math.min(cursor, text.length), score: 0 });
      start = cursor;
    }
  }
  if (start < text.length) chunks.push({ start, end: text.length, score: 0 });
  for (const chunk of chunks) {
    const body = text.slice(chunk.start, chunk.end).toLowerCase();
    let score = 0;
    for (const term of terms) {
      let count = 0;
      for (
        let at = body.indexOf(term);
        at !== -1 && count < 3;
        at = body.indexOf(term, at + term.length)
      )
        count++;
      score += count === 0 ? 0 : 1 + Math.log2(count);
    }
    if (terms.length > 1 && body.includes(phrase)) score += terms.length;
    chunk.score = score;
  }
  const ranked = chunks
    .map((chunk, index) => ({ ...chunk, index }))
    .filter((chunk) => chunk.score > 0)
    .toSorted((a, b) => b.score - a.score);
  const taken = new Set<number>();
  const picked: Array<{ index: number; score: number }> = [];
  for (const chunk of ranked) {
    if (picked.length >= maxPassages) break;
    if (taken.has(chunk.index)) continue;
    picked.push(chunk);
    for (const near of [chunk.index - 1, chunk.index, chunk.index + 1])
      taken.add(near);
  }
  const perPassage = Math.floor(limit / Math.max(picked.length, 1));
  return picked.map(({ index, score }) => {
    const from = chunks[Math.max(0, index - 1)].start;
    const to = chunks[Math.min(chunks.length - 1, index + 1)].end;
    const slice = text.slice(from, Math.min(to, from + perPassage));
    return {
      offset: base + from,
      text: slice,
      score: Math.round(score * 10) / 10,
    };
  });
}
