import type { PageRange } from "@repo/schemas";
import type { PdfSource, PdfTextItem } from "../knowledge-chunk";
import {
  type Block,
  type Heading,
  type Section,
  SectionBuilder,
  type TextBlock,
} from "./types";

interface PdfLine {
  page: number;
  text: string;
  x0: number;
  x1: number;
  /** Baseline, pdfjs convention: larger is higher on the page. */
  y: number;
  size: number;
  bold: boolean;
}

type Element =
  | { kind: "line"; line: PdfLine }
  | { kind: "heading"; heading: Heading };

export interface PdfStructure {
  root: Section;
  layout: "document" | "slides";
}

const BULLET = /^(?:[•●▪◦·‣∙]|[-–—*]|\d{1,3}[.)]|\(?[a-z]\))\s+/;
const TERMINAL = /[.!?:;]["')\]]?$/;
const HYPHEN = "[-\\u00AD\\u2010\\u2011]";

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function modeBySize(lines: PdfLine[]): number {
  const weights = new Map<number, number>();
  for (const line of lines) {
    const key = Math.round(line.size * 2) / 2;
    weights.set(key, (weights.get(key) ?? 0) + line.text.length);
  }
  let best = 10;
  let bestWeight = -1;
  for (const [size, weight] of weights) {
    if (weight > bestWeight || (weight === bestWeight && size < best)) {
      best = size;
      bestWeight = weight;
    }
  }
  return best;
}

function lineFrom(items: PdfTextItem[]): PdfLine {
  const sorted = items.slice().sort((a, b) => a.x - b.x);
  let text = "";
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (const item of sorted) {
    const gap = item.x - previousEnd;
    const needsSpace =
      text.length > 0 &&
      gap > 0.12 * item.fontSize &&
      !/\s$/.test(text) &&
      !/^\s/.test(item.str);
    text += (needsSpace ? " " : "") + item.str;
    previousEnd = item.x + item.width;
  }
  const weight = new Map<number, number>();
  let boldChars = 0;
  let chars = 0;
  for (const item of sorted) {
    const key = Math.round(item.fontSize * 2) / 2;
    weight.set(key, (weight.get(key) ?? 0) + item.str.length);
    chars += item.str.length;
    if (item.bold) boldChars += item.str.length;
  }
  let size = sorted[0]?.fontSize ?? 10;
  let top = -1;
  for (const [key, value] of weight) {
    if (value > top) {
      size = key;
      top = value;
    }
  }
  const anchor = sorted.reduce((best, item) =>
    item.fontSize > best.fontSize ? item : best,
  );
  return {
    page: sorted[0]?.page ?? 0,
    text: text.replace(/\s+/g, " ").trim(),
    x0: Math.min(...sorted.map((item) => item.x)),
    x1: Math.max(...sorted.map((item) => item.x + item.width)),
    y: anchor.y,
    size,
    bold: chars > 0 && boldChars * 2 > chars,
  };
}

function clusterLines(items: PdfTextItem[]): PdfLine[] {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const clusters: { y: number; items: PdfTextItem[] }[] = [];
  for (const item of sorted) {
    const cluster = clusters[clusters.length - 1];
    if (cluster && cluster.y - item.y <= 0.5 * item.fontSize) {
      cluster.items.push(item);
    } else clusters.push({ y: item.y, items: [item] });
  }
  return clusters.map((cluster) => lineFrom(cluster.items));
}

function findGutter(
  items: PdfTextItem[],
  width: number,
): { start: number; end: number } | null {
  const narrow = items.filter((item) => item.width <= 0.6 * width);
  if (narrow.length < 6) return null;
  const bins = 200;
  const cover = new Array<number>(bins).fill(0);
  for (const item of narrow) {
    const from = Math.max(0, Math.floor((item.x / width) * bins));
    const to = Math.min(
      bins - 1,
      Math.floor(((item.x + item.width) / width) * bins),
    );
    for (let bin = from; bin <= to; bin++) cover[bin] = (cover[bin] ?? 0) + 1;
  }
  const tolerance = Math.max(1, Math.floor(0.04 * narrow.length));
  const lo = Math.floor(0.3 * bins);
  const hi = Math.ceil(0.7 * bins);
  let best: { from: number; to: number } | null = null;
  let run: number | null = null;
  for (let bin = lo; bin <= hi + 1; bin++) {
    const open = bin <= hi && (cover[bin] ?? 0) <= tolerance;
    if (open && run === null) run = bin;
    if (!open && run !== null) {
      if (!best || bin - run > best.to - best.from + 1) {
        best = { from: run, to: bin - 1 };
      }
      run = null;
    }
  }
  if (!best) return null;
  const start = (best.from / bins) * width;
  const end = ((best.to + 1) / bins) * width;
  const typical = median(narrow.map((item) => item.fontSize)) ?? 10;
  if (end - start < Math.max(0.025 * width, typical)) return null;
  const left = narrow.filter((item) => item.x + item.width <= end).length;
  const right = narrow.filter((item) => item.x >= start).length;
  if (left < 0.2 * narrow.length || right < 0.2 * narrow.length) return null;
  return { start, end };
}

function pageLines(items: PdfTextItem[], width: number): PdfLine[] {
  const gutter = findGutter(items, width);
  if (!gutter) return clusterLines(items);

  const crosses = (item: PdfTextItem) =>
    item.x < gutter.end && item.x + item.width > gutter.start;
  const spanners = clusterLines(items.filter(crosses));
  const zoneOf = (item: PdfTextItem) =>
    spanners.filter((line) => line.y > item.y + 0.5 * item.fontSize).length;
  const middle = (gutter.start + gutter.end) / 2;
  const zones = spanners.length + 1;
  const out: PdfLine[] = [];
  for (let zone = 0; zone < zones; zone++) {
    const inZone = items.filter(
      (item) => !crosses(item) && zoneOf(item) === zone,
    );
    out.push(...clusterLines(inZone.filter((item) => item.x < middle)));
    out.push(...clusterLines(inZone.filter((item) => item.x >= middle)));
    const spanner = spanners[zone];
    if (spanner) out.push(spanner);
  }
  return out;
}

function dropRepeated(lines: PdfLine[], source: PdfSource): PdfLine[] {
  if (source.pageCount < 3) return lines;
  const body = modeBySize(lines);
  const key = (line: PdfLine) =>
    `${line.text.replace(/\d+/g, "#")}@${Math.round(line.y / (source.pageHeight * 0.01))}`;
  const inMargin = (line: PdfLine) =>
    line.size <= body * 1.05 &&
    (line.y > 0.88 * source.pageHeight || line.y < 0.12 * source.pageHeight);
  const pages = new Map<string, Set<number>>();
  for (const line of lines) {
    if (!inMargin(line)) continue;
    const set = pages.get(key(line)) ?? new Set<number>();
    set.add(line.page);
    pages.set(key(line), set);
  }
  return lines.filter((line) => {
    if (!inMargin(line)) return true;
    return (pages.get(key(line))?.size ?? 0) < 0.6 * source.pageCount;
  });
}

function normalizeKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function outlineElements(
  lines: PdfLine[],
  outline: NonNullable<PdfSource["outline"]>,
): Element[] {
  const minDepth = Math.min(...outline.map((entry) => entry.depth));
  const entries = outline
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.title.trim().length > 0)
    .sort((a, b) => a.entry.page - b.entry.page || a.index - b.index);

  const matched = new Map<number, { span: number; heading: Heading }>();
  const inserted = new Map<number, Heading[]>();
  let pointer = 0;
  for (const { entry } of entries) {
    const heading: Heading = {
      title: entry.title.replace(/\s+/g, " ").trim(),
      level: Math.min(6, entry.depth - minDepth + 1),
      page: { start: entry.page, end: entry.page },
    };
    const key = normalizeKey(entry.title);
    let found = -1;
    let span = 0;
    for (let i = pointer; i < lines.length && found < 0; i++) {
      const line = lines[i] as PdfLine;
      if (line.page < entry.page) continue;
      if (line.page > entry.page) break;
      let accumulated = "";
      for (let k = 0; k < 3; k++) {
        const part = lines[i + k];
        if (!part || part.page !== line.page) break;
        accumulated += normalizeKey(part.text);
        if (accumulated === key) {
          found = i;
          span = k + 1;
          break;
        }
        if (!key.startsWith(accumulated)) break;
      }
    }
    if (found >= 0) {
      matched.set(found, { span, heading });
      pointer = found + span;
      continue;
    }
    let at = pointer;
    while (at < lines.length && (lines[at] as PdfLine).page < entry.page) at++;
    inserted.set(at, [...(inserted.get(at) ?? []), heading]);
  }

  const out: Element[] = [];
  for (let i = 0; i <= lines.length; i++) {
    for (const heading of inserted.get(i) ?? []) {
      out.push({ kind: "heading", heading });
    }
    const hit = matched.get(i);
    if (hit) {
      out.push({ kind: "heading", heading: hit.heading });
      i += hit.span - 1;
      continue;
    }
    const line = lines[i];
    if (line) out.push({ kind: "line", line });
  }
  return out;
}

function fontElements(lines: PdfLine[], body: number): Element[] {
  const classOf = (line: PdfLine): string | null => {
    const words = line.text.split(/\s+/).length;
    if (!/\p{L}/u.test(line.text) || line.text.length > 120 || words > 16) {
      return null;
    }
    if (line.size >= body * 1.12) return `s${Math.round(line.size * 2) / 2}`;
    if (line.bold && line.size >= body * 0.95) return "b";
    return null;
  };

  const counts = new Map<string, { size: number; count: number }>();
  for (const line of lines) {
    const cls = classOf(line);
    if (!cls) continue;
    const entry = counts.get(cls) ?? {
      size: cls === "b" ? 0 : Number(cls.slice(1)),
      count: 0,
    };
    entry.count++;
    counts.set(cls, entry);
  }
  const ranked = [...counts.entries()]
    .filter(([, entry]) => entry.count <= 0.2 * lines.length)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 3)
    .map(([cls]) => cls);

  const out: Element[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as PdfLine;
    const cls = classOf(line);
    const level = cls ? ranked.indexOf(cls) + 1 : 0;
    if (!cls || level === 0) {
      out.push({ kind: "line", line });
      continue;
    }
    let title = line.text;
    let last = line;
    for (let next = lines[i + 1]; next; next = lines[i + 1]) {
      const sameHeading =
        classOf(next) === cls &&
        next.page === last.page &&
        last.y - next.y <= 1.8 * last.size;
      if (!sameHeading) break;
      title += ` ${next.text}`;
      last = next;
      i++;
    }
    out.push({
      kind: "heading",
      heading: { title, level, page: { start: line.page, end: line.page } },
    });
  }
  return out;
}

function joinLines(previous: string, next: string): string {
  const hyphenated = new RegExp(`\\S${HYPHEN}$`, "u");
  if (
    new RegExp(`\\p{Ll}${HYPHEN}$`, "u").test(previous) &&
    /^\p{Ll}/u.test(next)
  ) {
    return previous.slice(0, -1) + next;
  }
  if (hyphenated.test(previous)) {
    return previous.replace(/­$/, "-") + next;
  }
  return `${previous} ${next}`;
}

interface Paragraph {
  lines: PdfLine[];
  bullet: boolean;
}

function paragraphBlocks(
  lines: PdfLine[],
  source: PdfSource,
  body: number,
): Block[] {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const previous = lines[i - 1] as PdfLine;
    const line = lines[i] as PdfLine;
    const gap = previous.y - line.y;
    if (previous.page === line.page && gap > 0 && gap < 2.5 * previous.size) {
      gaps.push(gap);
    }
  }
  const lineGap = median(gaps) ?? 1.2 * body;

  const bandRight = (line: PdfLine): number => {
    let right = line.x1;
    for (const other of lines) {
      if (
        other.page === line.page &&
        Math.abs(other.x0 - line.x0) <= 0.1 * source.pageWidth
      ) {
        right = Math.max(right, other.x1);
      }
    }
    return right;
  };

  const breaksBetween = (previous: PdfLine, line: PdfLine): boolean => {
    if (BULLET.test(line.text)) return true;
    if (previous.page !== line.page) {
      return !(!TERMINAL.test(previous.text) && /^\p{Ll}/u.test(line.text));
    }
    if (line.y > previous.y + 0.5 * previous.size) return true;
    if (previous.y - line.y > 1.45 * lineGap) return true;
    if (Math.abs(line.size - previous.size) > 0.6) return true;
    const band = bandRight(previous) - previous.x0;
    return (
      band > 0 &&
      previous.x1 - previous.x0 < 0.75 * band &&
      /[.!?]["')\]]?$/.test(previous.text)
    );
  };

  const paragraphs: Paragraph[] = [];
  for (const line of lines) {
    const current = paragraphs[paragraphs.length - 1];
    const previous = current?.lines[current.lines.length - 1];
    if (current && previous && !breaksBetween(previous, line)) {
      current.lines.push(line);
    } else {
      paragraphs.push({ lines: [line], bullet: BULLET.test(line.text) });
    }
  }

  const pageOf = (items: PdfLine[]): PageRange => ({
    start: Math.min(...items.map((line) => line.page)),
    end: Math.max(...items.map((line) => line.page)),
  });
  const textOf = (paragraph: Paragraph): string =>
    paragraph.lines
      .map((line) => line.text)
      .reduce(joinLines)
      .replace(/­/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const blocks: Block[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i] as Paragraph;
    if (paragraph.bullet) {
      const run = [paragraph];
      while (paragraphs[i + 1]?.bullet) {
        i++;
        run.push(paragraphs[i] as Paragraph);
      }
      const items = run.map((entry) => ({ text: textOf(entry), atoms: [] }));
      blocks.push({
        kind: "list",
        text: items.map((item) => item.text).join("\n"),
        page: pageOf(run.flatMap((entry) => entry.lines)),
        items,
      });
      continue;
    }
    const text = textOf(paragraph);
    if (text.length === 0) continue;
    const block: TextBlock = {
      kind: "text",
      text,
      page: pageOf(paragraph.lines),
      atoms: [],
    };
    blocks.push(block);
  }
  return blocks;
}

function documentStructure(lines: PdfLine[], source: PdfSource): Section {
  const body = modeBySize(lines);
  const hasOutline = source.outline?.some((entry) => entry.title.trim());
  const elements =
    source.outline && hasOutline
      ? outlineElements(lines, source.outline)
      : fontElements(lines, body);

  const builder = new SectionBuilder();
  let buffer: PdfLine[] = [];
  const flush = () => {
    for (const block of paragraphBlocks(buffer, source, body))
      builder.add(block);
    buffer = [];
  };
  for (const element of elements) {
    if (element.kind === "line") buffer.push(element.line);
    else {
      flush();
      builder.open(element.heading);
    }
  }
  flush();
  return builder.root;
}

function slideKey(title: string): string {
  return normalizeKey(
    title
      .replace(/\(?\s*cont(?:'d|inued|\.)?\s*\)?\s*$/i, "")
      .replace(/\(?\s*\d+\s*\/\s*\d+\s*\)?\s*$/, ""),
  );
}

function slideStructure(lines: PdfLine[], source: PdfSource): Section {
  const root: Section = { blocks: [], children: [] };
  const body = modeBySize(lines);
  const byPage = new Map<number, PdfLine[]>();
  for (const line of lines) {
    byPage.set(line.page, [...(byPage.get(line.page) ?? []), line]);
  }
  let previousKey = "";
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const pageLinesList = byPage.get(page) ?? [];
    const largest = Math.max(...pageLinesList.map((line) => line.size));
    const first = pageLinesList.findIndex((line) => line.size === largest);
    let end = first + 1;
    while (pageLinesList[end]?.size === largest) end++;
    const title = pageLinesList
      .slice(first, end)
      .map((line) => line.text)
      .join(" ");
    const rest = [
      ...pageLinesList.slice(0, first),
      ...pageLinesList.slice(end),
    ];
    const blocks = paragraphBlocks(rest, source, body);
    const key = slideKey(title);
    const previous = root.children[root.children.length - 1];
    if (previous?.heading && key.length > 0 && key === previousKey) {
      previous.blocks.push(...blocks);
      if (previous.heading.page) previous.heading.page.end = page;
      continue;
    }
    root.children.push({
      heading: { title, level: 1, page: { start: page, end: page } },
      blocks,
      children: [],
    });
    previousKey = key;
  }
  return root;
}

export function pdfStructure(source: PdfSource): PdfStructure {
  const byPage = new Map<number, PdfTextItem[]>();
  for (const item of source.items) {
    const str = item.str.normalize("NFKC");
    if (str.trim().length === 0) continue;
    byPage.set(item.page, [...(byPage.get(item.page) ?? []), { ...item, str }]);
  }
  const allLines: PdfLine[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    allLines.push(...pageLines(byPage.get(page) ?? [], source.pageWidth));
  }
  const lines = dropRepeated(allLines, source).filter(
    (line) => line.text.length > 0,
  );

  const pagesWithText = new Set(lines.map((line) => line.page)).size;
  const characters = lines.reduce((sum, line) => sum + line.text.length, 0);
  const slides =
    source.pageWidth > source.pageHeight &&
    pagesWithText > 0 &&
    characters / pagesWithText < 1200;

  return slides
    ? { root: slideStructure(lines, source), layout: "slides" }
    : { root: documentStructure(lines, source), layout: "document" };
}
