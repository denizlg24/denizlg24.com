export type PageText = { page: number | null; text: string };
export type Chunk = { seq: number; page: number | null; content: string };

type ChunkOptions = {
  target?: number;
  max?: number;
  repeatFirstLine?: boolean;
};

const sentenceEnd = /[.!?;:](?:["')\]]+)?\s+/g;

function splitOversized(text: string, target: number, max: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = -1;
    for (const match of window.matchAll(sentenceEnd)) {
      const end = (match.index ?? 0) + match[0].length;
      if (end >= target * 0.5) cut = end;
    }
    if (cut < 0) cut = window.lastIndexOf(" ");
    if (cut < target * 0.5) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

function chunkOne(text: string, options: ChunkOptions): string[] {
  const target = options.target ?? 1500;
  const max = options.max ?? 2000;
  const units = (options.repeatFirstLine ? text.split(/\n/) : text.split(/\n{2,}/))
    .map((unit) => unit.trim())
    .filter(Boolean);
  const separator = options.repeatFirstLine ? "\n" : "\n\n";
  let header = options.repeatFirstLine ? units.shift() : undefined;
  if (header !== undefined && header.length > Math.min(300, Math.floor(max / 4))) {
    units.unshift(header);
    header = undefined;
  }
  const out: string[] = [];
  let current = "";
  const flush = () => {
    if (current) out.push(header ? `${header}\n${current}` : current);
    current = "";
  };
  const budget = header ? max - header.length - 1 : max;
  const goal = header ? Math.max(200, target - header.length - 1) : target;
  for (const unit of units) {
    const pieces =
      unit.length > budget ? splitOversized(unit, goal, Math.max(200, budget)) : [unit];
    for (const piece of pieces) {
      if (current && current.length + separator.length + piece.length > goal) flush();
      current = current ? `${current}${separator}${piece}` : piece;
      if (current.length >= goal) flush();
    }
  }
  flush();
  if (header && !out.length) out.push(header);
  return out;
}

/** Chunks never span pages, so a hit's page number is always exact. */
export function chunkPages(pages: PageText[], options: ChunkOptions = {}): Chunk[] {
  const chunks: Chunk[] = [];
  for (const { page, text } of pages)
    for (const content of chunkOne(text.trim(), options))
      chunks.push({ seq: chunks.length, page, content });
  return chunks;
}
