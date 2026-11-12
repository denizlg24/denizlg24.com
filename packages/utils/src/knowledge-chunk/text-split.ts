import type { Atom } from "./types";

export interface TextRange {
  start: number;
  end: number;
}

export interface SplitLimits {
  /** Pieces are packed up to this many tokens. */
  fill: number;
  /** A segment larger than this is split at the next finer granularity. */
  hard: number;
  count: (text: string) => number;
}

const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s)>\]]+/g;
const CLAUSE_PATTERN = /[,;:)\]—–]\s+/g;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function withUrlAtoms(text: string, atoms: Atom[]): Atom[] {
  const all = atoms.slice();
  for (const match of text.matchAll(URL_PATTERN)) {
    all.push({ start: match.index, end: match.index + match[0].length });
  }
  return all;
}

function isBlocked(position: number, atoms: Atom[]): boolean {
  return atoms.some((atom) => atom.start < position && position < atom.end);
}

export function sentenceCuts(text: string, atoms: Atom[]): number[] {
  const cuts: number[] = [];
  for (const segment of sentenceSegmenter.segment(text)) {
    if (segment.index > 0 && !isBlocked(segment.index, atoms)) {
      cuts.push(segment.index);
    }
  }
  return cuts;
}

function clauseCuts(text: string, atoms: Atom[]): number[] {
  const cuts: number[] = [];
  for (const match of text.matchAll(CLAUSE_PATTERN)) {
    const position = match.index + match[0].length;
    if (position < text.length && !isBlocked(position, atoms)) {
      cuts.push(position);
    }
  }
  return cuts;
}

/**
 * Word boundaries from the segmenter, minus those that fall between two
 * non-space characters of a space-delimited script: `self-adjoint`, `3.14e-10`
 * and identifiers are one token to the splitter even though the segmenter
 * would break them.
 */
function wordCuts(text: string, atoms: Atom[]): number[] {
  const cuts: number[] = [];
  for (const segment of wordSegmenter.segment(text)) {
    const position = segment.index;
    if (position === 0 || isBlocked(position, atoms)) continue;
    const before = text[position - 1] ?? "";
    const after = text[position] ?? "";
    const afterSpace = /\s/.test(before);
    const cjkEdge = CJK.test(before) || CJK.test(after);
    if ((afterSpace || cjkEdge) && !/\s/.test(after)) cuts.push(position);
  }
  return cuts;
}

function trimRange(text: string, range: TextRange): TextRange | null {
  let { start, end } = range;
  while (start < end && /\s/.test(text[start] ?? "")) start++;
  while (end > start && /\s/.test(text[end - 1] ?? "")) end--;
  return start < end ? { start, end } : null;
}

/**
 * Splits `text` into pieces that fit `limits`, preferring sentence cuts, then
 * clause punctuation, then word boundaries. A piece that no boundary can
 * shrink (one token longer than the budget) is returned whole.
 */
export function splitRanges(
  text: string,
  atoms: Atom[],
  limits: SplitLimits,
): TextRange[] {
  const levels = [
    sentenceCuts(text, atoms),
    clauseCuts(text, atoms),
    wordCuts(text, atoms),
  ];
  const tokens = (range: TextRange) =>
    limits.count(text.slice(range.start, range.end));

  const split = (range: TextRange, level: number): TextRange[] => {
    if (tokens(range) <= limits.hard || level >= levels.length) return [range];
    const cuts = (levels[level] ?? []).filter(
      (cut) => cut > range.start && cut < range.end,
    );
    if (cuts.length === 0) return split(range, level + 1);

    const bounds = [range.start, ...cuts, range.end];
    const pieces: TextRange[] = [];
    let current: TextRange | null = null;
    for (let i = 0; i < bounds.length - 1; i++) {
      const segment = { start: bounds[i] ?? 0, end: bounds[i + 1] ?? 0 };
      if (tokens(segment) > limits.hard) {
        if (current) pieces.push(current);
        const sub = split(segment, level + 1);
        const last = sub.pop();
        pieces.push(...sub);
        current = last ?? null;
        continue;
      }
      if (!current) {
        current = segment;
        continue;
      }
      const joined: TextRange = { start: current.start, end: segment.end };
      if (tokens(joined) <= limits.fill) current = joined;
      else {
        pieces.push(current);
        current = segment;
      }
    }
    if (current) pieces.push(current);
    return pieces;
  };

  const pieces: TextRange[] = [];
  for (const range of split({ start: 0, end: text.length }, 0)) {
    const trimmed = trimRange(text, range);
    if (trimmed) pieces.push(trimmed);
  }
  return pieces;
}
