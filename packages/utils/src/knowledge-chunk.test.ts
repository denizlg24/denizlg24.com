import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ChunkDraft,
  chunkContentHash,
  chunkMarkdown,
  chunkPdf,
  chunkTranscript,
  DEFAULT_CHUNK_BUDGET,
  estimateTokens,
  type PdfSource,
  type PdfTextItem,
  type TranscriptSegment,
} from "./knowledge-chunk";

const { max, min } = DEFAULT_CHUNK_BUDGET;

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures", "knowledge", name), "utf8");

function headerOf(title: string, chunk: ChunkDraft): string {
  const lines = [title, chunk.headingPath.join(" › ")];
  if (chunk.page) {
    lines.push(
      chunk.page.start === chunk.page.end
        ? `[p. ${chunk.page.start}]`
        : `[pp. ${chunk.page.start}–${chunk.page.end}]`,
    );
  }
  return `${lines.filter(Boolean).join("\n")}\n\n`;
}

/**
 * `allowOver` lists ordinals that may exceed the max: only a chunk whose one
 * unsplittable unit (display math, a table row, a code line) is itself larger.
 * `allowUnder` lists ordinals that may sit under the min: a section-forced
 * remainder whose neighbours were too full to absorb it.
 */
function expectInvariants(
  title: string,
  chunks: ChunkDraft[],
  options: { allowOver?: number[]; allowUnder?: number[] } = {},
): void {
  expect(chunks.length).toBeGreaterThan(0);
  chunks.forEach((chunk, index) => {
    expect(chunk.ordinal).toBe(index);
    expect(chunk.text.startsWith(headerOf(title, chunk))).toBe(true);
    expect(chunk.text.endsWith(chunk.body)).toBe(true);
    expect(chunk.tokenCount).toBe(estimateTokens(chunk.text));
    if (!options.allowOver?.includes(index)) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(max);
    }
    if (chunks.length > 1 && !options.allowUnder?.includes(index)) {
      expect(chunk.tokenCount).toBeGreaterThanOrEqual(min);
    }
    const lines = chunk.body.split("\n").filter((line) => line.trim());
    expect(lines.some((line) => !/^#{1,6}\s/.test(line))).toBe(true);
  });
}

function wordsOf(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter(Boolean));
}

function expectNoCutWords(markdown: string, chunks: ChunkDraft[]): void {
  const known = wordsOf(markdown);
  for (const chunk of chunks) {
    for (const word of chunk.body.split(/\s+/).filter(Boolean)) {
      expect(known.has(word)).toBe(true);
    }
  }
}

function expectOffsets(markdown: string, chunks: ChunkDraft[]): void {
  for (const chunk of chunks) {
    expect(chunk.sourceStart).toBeDefined();
    expect(chunk.sourceEnd).toBeDefined();
    const window = markdown.slice(chunk.sourceStart, chunk.sourceEnd);
    for (const part of chunk.body.split("\n\n")) {
      expect(window).toContain(part);
    }
  }
}

const dollars = (text: string) => (text.match(/\$/g) ?? []).length;
const fences = (text: string) =>
  text.split("\n").filter((line) => /^(```|~~~)/.test(line)).length;

describe("chunkMarkdown", () => {
  test("lecture with nested headings", () => {
    const markdown = fixture("lecture.md");
    const chunks = chunkMarkdown({ title: "Linear Algebra", markdown });
    expectInvariants("Linear Algebra", chunks);
    expectNoCutWords(markdown, chunks);
    expectOffsets(markdown, chunks);

    const paths = chunks.map((chunk) => chunk.headingPath.join(" › "));
    expect(paths[0]).toBe("Lecture 4: Eigenvalues");
    expect(paths).toContain(
      "Lecture 4: Eigenvalues › Eigenvalues and eigenvectors › Characteristic polynomial",
    );
    const polynomial = chunks.filter((chunk) =>
      chunk.headingPath.includes("Characteristic polynomial"),
    );
    expect(polynomial.length).toBeGreaterThan(1);
    for (const chunk of polynomial) {
      expect(chunk.body).not.toContain("### Characteristic polynomial");
    }
    // A section that fits is one chunk and keeps its source text verbatim.
    const definitions = chunks.find((chunk) =>
      chunk.headingPath.includes("Definitions"),
    );
    expect(definitions?.body.startsWith("A")).toBe(false);
  });

  test("small subsections merge with siblings under their parent, never across it", () => {
    const words = (count: number) =>
      Array.from({ length: count }, (_, i) => `w${i}`).join(" ");
    const markdown = [
      "# A",
      "",
      "## A1",
      "",
      words(60),
      "",
      "## A2",
      "",
      "short two.",
      "",
      "## A3",
      "",
      words(60),
      "",
      "# B",
      "",
      words(120),
      "",
    ].join("\n");
    const chunks = chunkMarkdown(
      { title: "T", markdown },
      {
        budget: { target: 100, max: 150, min: 30 },
        countTokens: (text) => text.split(/\s+/).filter(Boolean).length,
      },
    );
    const merged = chunks.find((chunk) => chunk.body.includes("## A2"));
    expect(merged?.headingPath).toEqual(["A"]);
    expect(merged?.body).toContain("short two.");
    expect(merged?.body).not.toContain("# B");
    for (const chunk of chunks) {
      if (chunk.headingPath[0] === "B")
        expect(chunk.body).not.toContain("short two.");
    }
  });

  test("long proof keeps display math with its introduction and never cuts math", () => {
    const markdown = fixture("proof.md");
    const chunks = chunkMarkdown({ title: "Real Analysis", markdown });
    expectInvariants("Real Analysis", chunks);
    expectNoCutWords(markdown, chunks);
    expectOffsets(markdown, chunks);
    expect(chunks.length).toBeGreaterThan(8);
    for (const chunk of chunks) {
      expect(dollars(chunk.body) % 2).toBe(0);
      const intro = chunk.body.indexOf("Consider the quantity:");
      if (intro >= 0) {
        expect(chunk.body.slice(intro)).toContain("$$R_");
      }
    }
    const statement = chunks.find((chunk) => chunk.body.includes("Let $A$"));
    expect(statement?.body).toContain("such that:");
    expect(statement?.body).toContain("\\operatorname{diag}");
  });

  test("an atomic unit larger than the max stays whole", () => {
    const equation = `$$${Array.from({ length: 400 }, (_, i) => `a_{${i}}`).join(" + ")}$$`;
    const markdown = `# Big\n\nIntroduction:\n\n${equation}\n\nAfter.`;
    const chunks = chunkMarkdown({ title: "T", markdown });
    const holder = chunks.find((chunk) => chunk.body.includes(equation));
    expect(holder).toBeDefined();
    expect(holder?.tokenCount).toBeGreaterThan(max);
    expect(holder?.body).toContain("Introduction:");
  });

  test("a GFM table over the max splits into row groups that repeat the header", () => {
    const markdown = fixture("table.md");
    const chunks = chunkMarkdown({ title: "Bench", markdown });
    expectInvariants("Bench", chunks);
    const header = "| id | operator | value | note |";
    const pieces = chunks.filter((chunk) => chunk.body.includes(header));
    expect(pieces.length).toBeGreaterThan(2);
    const seen = new Set<string>();
    for (const chunk of pieces) {
      const lines = chunk.body.split("\n");
      const at = lines.indexOf(header);
      expect(lines[at + 1]).toBe("| --- | --- | ---: | --- |");
      for (const row of lines.slice(at + 2).filter((l) => l.startsWith("|"))) {
        expect(row.split("|").length).toBe(header.split("|").length);
        seen.add(row);
      }
    }
    const rows = markdown.split("\n").filter((l) => /^\| \d+ /.test(l));
    expect(seen.size).toBe(rows.length);
    for (const row of rows) expect(seen.has(row)).toBe(true);
  });

  test("code-heavy note re-fences cut code and never cuts a line", () => {
    const markdown = fixture("code.md");
    const chunks = chunkMarkdown({ title: "Numerics", markdown });
    expectInvariants("Numerics", chunks);
    const sourceLines = new Set(markdown.split("\n"));
    for (const chunk of chunks) {
      expect(fences(chunk.body) % 2).toBe(0);
      for (const line of chunk.body.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("```")) {
          expect(sourceLines.has(line) || /^(#|[A-Z])/.test(trimmed)).toBe(
            true,
          );
        }
      }
    }
    const cut = chunks.filter((chunk) => chunk.body.includes("```python\n"));
    expect(cut.length).toBeGreaterThan(2);
    expect(chunks.some((chunk) => chunk.body.includes("```bash"))).toBe(true);
  });

  test("a note with no headings has an empty heading path and overlap on cut paragraphs", () => {
    const markdown = fixture("plain.md");
    const chunks = chunkMarkdown({ title: "Scratch", markdown });
    expectInvariants("Scratch", chunks);
    expectNoCutWords(markdown, chunks);
    for (const chunk of chunks) expect(chunk.headingPath).toEqual([]);

    const paragraph = `# H\n\n${markdown.trim().split("\n\n").join(" ")}\n`;
    const cut = chunkMarkdown({ title: "T", markdown: paragraph });
    expect(cut.length).toBeGreaterThan(1);
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    const sentences = (text: string) =>
      Array.from(segmenter.segment(text), (part) => part.segment.trim());
    for (let i = 1; i < cut.length; i++) {
      const previous = sentences((cut[i - 1] as ChunkDraft).body);
      const current = sentences((cut[i] as ChunkDraft).body);
      expect(current[0]).toBe(previous[previous.length - 1]);
    }
    expectOffsets(paragraph, cut);
  });

  test("single small note is one chunk", () => {
    const chunks = chunkMarkdown({ title: "T", markdown: "# Hi\n\nTiny." });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toEqual(["Hi"]);
    expect(chunks[0]?.body).toBe("Tiny.");
  });

  test("empty and heading-only notes produce no chunks", () => {
    expect(chunkMarkdown({ title: "T", markdown: "" })).toEqual([]);
    expect(chunkMarkdown({ title: "T", markdown: "# A\n\n## B\n" })).toEqual(
      [],
    );
  });

  test("inline math, links and code are atomic under a tight budget", () => {
    const markdown = Array.from(
      { length: 40 },
      (_, i) =>
        `Item ${i} relates $x_{n+1} = A x_n$ to [the long linked notes](https://example.com/a/b c) and \`code span ${i}\` here.`,
    ).join(" ");
    const chunks = chunkMarkdown(
      { title: "T", markdown },
      {
        budget: { target: 20, max: 30, min: 5, overlap: 0 },
        countTokens: (text) => text.split(/\s+/).filter(Boolean).length,
      },
    );
    expect(chunks.length).toBeGreaterThan(10);
    for (const chunk of chunks) {
      expect(dollars(chunk.body) % 2).toBe(0);
      expect((chunk.body.match(/`/g) ?? []).length % 2).toBe(0);
      expect((chunk.body.match(/\[the long/g) ?? []).length).toBe(
        (chunk.body.match(/c\)/g) ?? []).length,
      );
    }
  });

  test("a long URL is never cut", () => {
    const url = `https://example.com/${"segment-".repeat(20)}end`;
    const markdown = `${"filler ".repeat(30)}${url} ${"filler ".repeat(30)}`;
    const chunks = chunkMarkdown(
      { title: "T", markdown },
      {
        budget: { target: 20, max: 30, min: 5, overlap: 0 },
        countTokens: (t) => t.split(/\s+/).filter(Boolean).length,
      },
    );
    expect(chunks.filter((chunk) => chunk.body.includes(url))).toHaveLength(1);
  });

  test("is deterministic and honours a custom token counter", () => {
    const markdown = fixture("lecture.md");
    const a = chunkMarkdown({ title: "T", markdown });
    expect(chunkMarkdown({ title: "T", markdown })).toEqual(a);
    const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
    const small = chunkMarkdown(
      { title: "T", markdown },
      { budget: { target: 60, max: 90, min: 20 }, countTokens: words },
    );
    expect(small.length).toBeGreaterThan(a.length);
    for (const chunk of small) expect(chunk.tokenCount).toBe(words(chunk.text));
  });
});

describe("estimateTokens and chunkContentHash", () => {
  test("estimate is conservative and monotonic", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(32))).toBe(10);
    expect(estimateTokens("a b c d e f g h")).toBeGreaterThanOrEqual(8);
  });

  test("sha-256 hex", async () => {
    expect(await chunkContentHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

function textItem(
  page: number,
  x: number,
  y: number,
  str: string,
  size = 10,
  bold = false,
): PdfTextItem {
  return {
    page,
    str,
    x,
    y,
    width: str.length * size * 0.5,
    height: size,
    fontSize: size,
    fontName: bold ? "F2" : "F1",
    bold,
    hasEOL: true,
  };
}

const LEXICON = [
  "operator",
  "spectrum",
  "eigenvalue",
  "projection",
  "orthogonal",
  "bounded",
  "compact",
  "resolvent",
  "analytic",
  "self-adjoint",
  "functional",
  "the",
  "of",
  "and",
  "a",
  "is",
  "that",
  "every",
  "has",
  "its",
  "on",
  "in",
  "to",
  "dense",
  "domain",
  "closed",
  "unbounded",
  "extension",
  "decomposition",
  "theorem",
];

let seed = 11;
function rnd(n: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed % n;
}

function sentenceOf(): string {
  const words = Array.from(
    { length: 9 + rnd(6) },
    () => LEXICON[rnd(LEXICON.length)] as string,
  );
  return `${(words[0] as string).replace(/^./, (c) => c.toUpperCase())} ${words.slice(1).join(" ")}.`;
}

function paragraphOf(sentences: number): string {
  return Array.from({ length: sentences }, sentenceOf).join(" ");
}

/** Wraps to `width` characters, hyphenating long lowercase words at line end. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const room = width - line.length - (line ? 1 : 0);
    if (word.length <= room) {
      line = line ? `${line} ${word}` : word;
      continue;
    }
    if (/^[a-z]{8,}$/.test(word) && room >= 5) {
      lines.push(`${line ? `${line} ` : ""}${word.slice(0, room - 1)}-`);
      line = word.slice(room - 1);
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

function twoColumnPaper(): {
  source: PdfSource;
  paragraphs: string[];
} {
  const items: PdfTextItem[] = [];
  const paragraphs: string[] = [];
  const leading = 12;
  type Entry = { heading?: { text: string; size: number }; lines: string[] };
  const queue: Entry[] = [
    { heading: { text: "1 Introduction", size: 14 }, lines: [] },
  ];
  const texts = [
    "ALPHA",
    "BETA",
    "GAMMA",
    "DELTA",
    "EPSILON",
    "ZETA",
    "ETA",
    "THETA",
    "IOTA",
    "KAPPA",
    "LAMBDA",
    "MU",
    "NU",
    "XI",
    "OMICRON",
    "PI",
    "RHO",
    "SIGMA",
    "TAU",
    "UPSILON",
    "PHI",
    "CHI",
    "PSI",
    "OMEGA",
  ];
  texts.forEach((tag, index) => {
    if (index === 12)
      queue.push({ heading: { text: "2 Methods", size: 14 }, lines: [] });
    if (index === 20)
      queue.push({ heading: { text: "2.1 Setup", size: 12 }, lines: [] });
    const text = `${tag} ${paragraphOf(7)}`;
    paragraphs.push(text);
    queue.push({ lines: wrap(text, 44) });
  });

  let page = 1;
  let column = 0;
  let y = page === 1 ? 690 : 740;
  const top = (p: number) => (p === 1 ? 690 : 740);
  const bottom = 60;
  const xs = [50, 320];
  for (const entry of queue) {
    const height = entry.heading ? 24 : entry.lines.length * leading + leading;
    if (y - height < bottom) {
      column++;
      if (column === 2) {
        column = 0;
        page++;
      }
      y = top(page);
    }
    if (entry.heading) {
      items.push(
        textItem(
          page,
          xs[column] as number,
          y,
          entry.heading.text,
          entry.heading.size,
          true,
        ),
      );
      y -= 24;
      continue;
    }
    for (const line of entry.lines) {
      items.push(textItem(page, xs[column] as number, y, line));
      y -= leading;
    }
    y -= leading;
  }

  items.push(textItem(1, 150, 740, "Spectral Methods", 20, true));
  const pageCount = page;
  for (let p = 1; p <= pageCount; p++) {
    items.push(textItem(p, 200, 770, "Journal of Spectral Theory", 9));
    items.push(textItem(p, 290, 30, `Page ${p}`, 9));
  }
  return {
    paragraphs,
    source: {
      title: "Spectral Methods",
      pageCount,
      pageWidth: 612,
      pageHeight: 792,
      items,
    },
  };
}

describe("chunkPdf: two-column paper", () => {
  const { source, paragraphs } = twoColumnPaper();
  const result = chunkPdf(source);

  test("is a document, reads columns in order, and keeps invariants", () => {
    expect(result.layout).toBe("document");
    expectInvariants("Spectral Methods", result.chunks);
    for (const chunk of result.chunks) {
      expect(chunk.sourceStart).toBeUndefined();
      expect(chunk.sourceEnd).toBeUndefined();
      expect(chunk.page).toBeDefined();
    }
  });

  test("drops running headers and page numbers", () => {
    for (const chunk of result.chunks) {
      expect(chunk.body).not.toContain("Journal of Spectral Theory");
      expect(chunk.body).not.toMatch(/Page \d/);
    }
  });

  test("rejoins hyphenated line breaks, keeps real hyphens, and never interleaves columns", () => {
    const joined = result.chunks.map((chunk) => chunk.body).join("\n");
    for (const paragraph of paragraphs) {
      const sentences = paragraph.split(/(?<=\.)\s+/);
      for (const sentence of sentences) {
        expect(joined).toContain(sentence.replace(/^(\w+) /, "$1 "));
      }
    }
    expect(joined).toContain("self-adjoint");
    expect(joined).not.toMatch(/[a-z]-\s+[a-z]/);
  });

  test("orders the left column before the right one", () => {
    const joined = result.chunks.map((chunk) => chunk.body).join("\n");
    const order = ["ALPHA", "BETA", "GAMMA", "DELTA", "EPSILON"].map((tag) =>
      joined.indexOf(tag),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("infers heading levels from font size", () => {
    const paths = result.chunks.map((chunk) => chunk.headingPath);
    expect(paths).toContainEqual(["Spectral Methods", "1 Introduction"]);
    const methods = paths.find((path) => path.includes("2 Methods"));
    expect(methods?.slice(0, 2)).toEqual(["Spectral Methods", "2 Methods"]);
    expect(paths.some((path) => path.includes("2.1 Setup"))).toBe(true);
  });

  test("tracks pages", () => {
    const pages = result.chunks.map((chunk) => chunk.page);
    for (const page of pages) {
      expect(page?.start).toBeGreaterThanOrEqual(1);
      expect(page?.end).toBeLessThanOrEqual(source.pageCount);
      expect(page?.end).toBeGreaterThanOrEqual(page?.start ?? 0);
    }
    expect(result.chunks[0]?.page?.start).toBe(1);
    expect(result.chunks.at(-1)?.page?.end).toBe(source.pageCount);
    expect(source.pageCount).toBeGreaterThan(2);
  });

  test("the outline wins over font sizes", () => {
    const outlined = chunkPdf({
      ...source,
      outline: [
        { title: "Spectral Methods", page: 1, depth: 0 },
        { title: "1 Introduction", page: 1, depth: 1 },
        {
          title: "2 Methods",
          page:
            source.items.find((item) => item.str === "2 Methods")?.page ?? 1,
          depth: 1,
        },
      ],
    });
    const paths = outlined.chunks.map((chunk) => chunk.headingPath);
    expect(paths).toContainEqual(["Spectral Methods", "1 Introduction"]);
    expect(paths.some((path) => path.includes("2 Methods"))).toBe(true);
    expect(paths.some((path) => path.includes("2.1 Setup"))).toBe(false);
    expect(
      outlined.chunks.some((chunk) => chunk.body.includes("2.1 Setup")),
    ).toBe(true);
  });

  test("ligatures are normalized", () => {
    const single = chunkPdf({
      title: "T",
      pageCount: 1,
      pageWidth: 612,
      pageHeight: 792,
      items: [textItem(1, 50, 700, "The ﬁnal eﬀect of a ﬂow.")],
    });
    expect(single.chunks[0]?.body).toBe("The final effect of a flow.");
  });
});

function slideDeck(): PdfSource {
  const items: PdfTextItem[] = [];
  const slides: { title: string; bullets: string[] }[] = [
    {
      title: "Eigenvalues",
      bullets: [
        "Definition of an eigenvalue",
        "Characteristic polynomial",
        "Geometric versus algebraic multiplicity",
      ],
    },
    {
      title: "Eigenvalues (cont.)",
      bullets: [
        "Diagonalizability criteria",
        "Worked example with a 3x3 matrix",
      ],
    },
    {
      title: "Spectral theorem",
      bullets: [
        "Symmetric matrices have real eigenvalues",
        "Eigenvectors can be chosen orthonormal",
      ],
    },
    {
      title: "Applications",
      bullets: Array.from({ length: 14 }, () => sentenceOf()),
    },
    {
      title: "Applications",
      bullets: Array.from({ length: 14 }, () => sentenceOf()),
    },
    { title: "Summary", bullets: ["Spectrum determines the dynamics"] },
  ];
  slides.forEach((slide, index) => {
    const page = index + 1;
    items.push(textItem(page, 60, 480, slide.title, 28, true));
    slide.bullets.forEach((bullet, row) => {
      items.push(textItem(page, 80, 420 - row * 22, `• ${bullet}`, 16));
    });
    items.push(textItem(page, 40, 20, "MATH 201 · Lecture 4", 9));
    items.push(textItem(page, 900, 20, String(page), 9));
  });
  return {
    title: "Lecture 4 slides",
    pageCount: slides.length,
    pageWidth: 960,
    pageHeight: 540,
    items,
  };
}

describe("chunkPdf: slide deck", () => {
  const source = slideDeck();
  const result = chunkPdf(source);

  test("is detected as slides, one section per page title", () => {
    expect(result.layout).toBe("slides");
    expectInvariants("Lecture 4 slides", result.chunks);
    const joined = result.chunks.map((chunk) => chunk.body).join("\n");
    expect(joined).toContain("# Spectral theorem");
    expect(joined).not.toContain("MATH 201");
  });

  test("consecutive slides with the same title merge into one section", () => {
    const joined = result.chunks.map((chunk) => chunk.text).join("\n");
    expect((joined.match(/Eigenvalues/g) ?? []).length).toBeLessThan(5);
    const eigen = result.chunks.find((chunk) =>
      chunk.body.includes("Definition of an eigenvalue"),
    );
    expect(eigen?.body).toContain("Diagonalizability criteria");
    expect(eigen?.page).toEqual({ start: 1, end: expect.any(Number) });
    const applications = result.chunks.filter((chunk) =>
      chunk.headingPath.includes("Applications"),
    );
    expect(applications.length).toBeGreaterThan(0);
    expect(
      result.chunks.filter((chunk) => chunk.body.includes("# Applications"))
        .length + applications.length,
    ).toBeGreaterThan(0);
  });

  test("pages cover the deck and slides are listed as bullets", () => {
    expect(result.chunks[0]?.page?.start).toBe(1);
    expect(result.chunks.at(-1)?.page?.end).toBe(source.pageCount);
    const bullets = result.chunks.find((chunk) =>
      chunk.body.includes("• Characteristic polynomial"),
    );
    expect(bullets?.body).toContain(
      "• Definition of an eigenvalue\n• Characteristic polynomial",
    );
  });
});

function transcript(): { segments: TranscriptSegment[] } {
  const segments: TranscriptSegment[] = [];
  let t = 0;
  for (let i = 0; i < 60; i++) {
    const text =
      i % 7 === 3
        ? `${sentenceOf()} ${sentenceOf().slice(0, 40)}`
        : i % 7 === 4
          ? `${sentenceOf().slice(40)} ${sentenceOf()}`
          : `${sentenceOf()} ${sentenceOf()}`;
    segments.push({ startMs: t, endMs: t + 20_000, text });
    t += 20_000;
  }
  return { segments };
}

describe("chunkTranscript", () => {
  const { segments } = transcript();
  const chunks = chunkTranscript({
    title: "Lecture recording",
    recordedAt: "2026-03-14T10:00:00.000Z",
    segments,
  });

  test("packs on sentence boundaries with a dated header", () => {
    expect(chunks.length).toBeGreaterThan(3);
    chunks.forEach((chunk, index) => {
      expect(chunk.ordinal).toBe(index);
      expect(chunk.text.startsWith("Lecture recording\n2026-03-14\n\n")).toBe(
        true,
      );
      expect(chunk.tokenCount).toBeLessThanOrEqual(max);
      expect(chunk.headingPath).toEqual([]);
      if (index < chunks.length - 1) expect(chunk.body).toMatch(/[.!?]$/);
      if (chunks.length > 1)
        expect(chunk.tokenCount).toBeGreaterThanOrEqual(min);
    });
  });

  test("carries monotonic times that span the recording", () => {
    expect(chunks[0]?.startMs).toBe(0);
    expect(chunks.at(-1)?.endMs).toBe(60 * 20_000);
    let previousEnd = 0;
    for (const chunk of chunks) {
      expect(chunk.startMs).toBeDefined();
      expect(chunk.endMs).toBeGreaterThanOrEqual(chunk.startMs ?? 0);
      expect(chunk.startMs).toBeGreaterThanOrEqual(previousEnd - 20_000);
      previousEnd = chunk.endMs ?? 0;
    }
  });

  test("omits the date without recordedAt and drops empty segments", () => {
    const plain = chunkTranscript({
      title: "T",
      segments: [
        { startMs: 0, endMs: 1000, text: "  " },
        { startMs: 1000, endMs: 3000, text: "Hello there. General Kenobi." },
      ],
    });
    expect(plain).toHaveLength(1);
    expect(plain[0]?.text).toBe("T\n\nHello there. General Kenobi.");
    expect(plain[0]?.startMs).toBe(1000);
    expect(plain[0]?.endMs).toBe(3000);
    expect(chunkTranscript({ title: "T", segments: [] })).toEqual([]);
  });
});
