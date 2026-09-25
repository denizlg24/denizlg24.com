// remark-math only knows `$` and `$$`, and CommonMark reads `\[` and `\(` as
// escaped punctuation, so LaTeX-style delimiters reach the renderer as literal
// brackets. This rewrites them into the dollar forms before parsing.

const CONTAINER_PREFIX =
  /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*/;
const LIST_MARKER = /\d{1,9}[.)]|[-*+]/g;
const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^(`{3,}|~{3,})[ \t]*$/;
const BLANK_LINE = /^[ \t>]*$/;

export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown.includes("\\[") && !markdown.includes("\\(")) return markdown;

  const lines = markdown.split("\n");
  const out: string[] = [];
  let prose: string[] = [];
  let fence: { char: string; length: number } | null = null;
  const flushProse = () => {
    if (prose.length) out.push(rewriteProse(prose.join("\n")));
    prose = [];
  };

  for (const line of lines) {
    const content = line.slice(CONTAINER_PREFIX.exec(line)?.[0].length ?? 0);
    if (fence) {
      out.push(line);
      const close = FENCE_CLOSE.exec(content);
      if (close?.[1][0] === fence.char && close[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(content);
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      flushProse();
      out.push(line);
      fence = { char: open[1][0], length: open[1].length };
      continue;
    }
    prose.push(line);
  }
  flushProse();

  return out.join("\n");
}

function rewriteProse(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "`") {
      const run = runLength(text, i, "`");
      const close = findCodeSpanClose(text, i + run, run);
      const end = close === -1 ? i + run : close + run;
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (char !== "\\") {
      out += char;
      i++;
      continue;
    }

    const next = text[i + 1];
    if (next === "(" || next === "[") {
      const end = findMathClose(text, i + 2, next === "(" ? "\\)" : "\\]");
      const inner = end === -1 ? "" : text.slice(i + 2, end);
      if (inner.trim()) {
        out +=
          next === "("
            ? inlineMath(inner)
            : displayMath(text, i, end + 2, inner);
        i = end + 2;
        continue;
      }
    }
    // Consumed as a pair so `\\[` stays a literal backslash and bracket.
    out += text.slice(i, i + 2);
    i += 2;
  }
  return out;
}

function inlineMath(inner: string): string {
  const fence = "$".repeat(longestRun(inner, "$") + 1);
  return fence + inner + fence;
}

// A display block needs `$$` fences on their own lines; `$$x$$` inside a line
// is inline math to remark-math. When the delimiters share a line with text,
// breaking it would split a paragraph or a table row, so that case stays
// inline and only borrows display style.
function displayMath(
  text: string,
  start: number,
  end: number,
  inner: string,
): string {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const before = text.slice(lineStart, start);
  const lineEnd = text.indexOf("\n", end);
  const after = text.slice(end, lineEnd === -1 ? text.length : lineEnd);
  const ownsLine =
    CONTAINER_PREFIX.exec(before)?.[0].length === before.length &&
    !after.trim();

  if (!ownsLine) return inlineMath(`\\displaystyle ${inner.trim()}`);

  const indent = before.replace(LIST_MARKER, (marker) =>
    " ".repeat(marker.length),
  );
  const innerLines = inner.split("\n");
  const body: string[] = [];
  const first = innerLines[0].trim();
  if (first) body.push(indent + first);
  if (innerLines.length > 1) {
    body.push(...innerLines.slice(1, -1));
    const last = innerLines[innerLines.length - 1];
    if (!BLANK_LINE.test(last)) body.push(last.trimEnd());
  }
  return ["$$", ...body, `${indent}$$`].join("\n");
}

function findMathClose(text: string, from: number, closer: string): number {
  let j = from;
  while (j < text.length) {
    const char = text[j];
    if (char === "\\") {
      if (text.startsWith(closer, j)) return j;
      j += 2;
      continue;
    }
    if (char === "\n" && startsBlankLine(text, j + 1)) return -1;
    j++;
  }
  return -1;
}

function findCodeSpanClose(text: string, from: number, run: number): number {
  let j = from;
  while (j < text.length) {
    const char = text[j];
    if (char === "`") {
      const length = runLength(text, j, "`");
      if (length === run) return j;
      j += length;
      continue;
    }
    if (char === "\n" && startsBlankLine(text, j + 1)) return -1;
    j++;
  }
  return -1;
}

function startsBlankLine(text: string, from: number): boolean {
  const end = text.indexOf("\n", from);
  return BLANK_LINE.test(text.slice(from, end === -1 ? text.length : end));
}

function runLength(text: string, from: number, char: string): number {
  let j = from;
  while (text[j] === char) j++;
  return j - from;
}

function longestRun(text: string, char: string): number {
  let longest = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== char) continue;
    const length = runLength(text, i, char);
    longest = Math.max(longest, length);
    i += length - 1;
  }
  return longest;
}
