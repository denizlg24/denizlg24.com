export type NarratedKind = "code" | "table" | "math";

export type SpeechSegment =
  | { kind: "text"; text: string }
  | { kind: NarratedKind; text: string; before: string };

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const ENVIRONMENT_OPEN = /^\s*\\begin\{([a-zA-Z*]+)\}/;
/**
 * Pandoc's rule for `$…$`: no space just inside either dollar and no digit
 * right after the closing one, which is what keeps "$5 and $10" prose.
 */
const INLINE_MATH =
  /(?<![\\$])\$(?=[^\s$])[^$\n]*?[^\s\\$]\$(?![\d$])|\\\(.+?\\\)/;
const CONTEXT_CHARS = 240;

function displayMathClose(line: string): RegExp | null {
  const trimmed = line.trim();
  if (trimmed.startsWith("$$")) return /\$\$\s*$/;
  if (trimmed.startsWith("\\[")) return /\\\]\s*$/;
  const environment = ENVIRONMENT_OPEN.exec(line)?.[1];
  if (environment) {
    return new RegExp(`\\\\end\\{${environment.replace("*", "\\*")}\\}\\s*$`);
  }
  return null;
}

function closesOnOpeningLine(line: string, close: RegExp): boolean {
  const trimmed = line.trim();
  const delimited = trimmed.startsWith("$$") || trimmed.startsWith("\\[");
  return close.test(delimited ? trimmed.slice(2) : trimmed);
}

type Block = { kind: "paragraph" | "code" | "math"; lines: string[] };

/** Splits a paragraph around a GFM table: a `|` header line over a delimiter row, and every `|` line after. */
function splitTable(
  lines: string[],
): Array<{ kind: "text" | "table"; lines: string[] }> {
  const delimiter = lines.findIndex(
    (line, index) =>
      index > 0 &&
      line.includes("|") &&
      TABLE_DELIMITER.test(line) &&
      lines[index - 1]?.includes("|"),
  );
  if (delimiter < 0) return [{ kind: "text", lines }];
  let end = delimiter + 1;
  while (end < lines.length && lines[end]?.includes("|")) end += 1;
  const parts: Array<{ kind: "text" | "table"; lines: string[] }> = [];
  if (delimiter > 1)
    parts.push({ kind: "text", lines: lines.slice(0, delimiter - 1) });
  parts.push({ kind: "table", lines: lines.slice(delimiter - 1, end) });
  if (end < lines.length) parts.push(...splitTable(lines.slice(end)));
  return parts;
}

/**
 * Reads markdown-ish text block by block. A paragraph ends at a blank line; a
 * fence or display-math block runs to its closer, so a streamed source never
 * hands half a table or half a code block to the narrator.
 */
async function* blocks(
  parts: AsyncIterable<string> | Iterable<string>,
): AsyncGenerator<Block> {
  let pending = "";
  let current: Block | null = null;
  let close: RegExp | null = null;

  function* line(raw: string): Generator<Block> {
    if (current && current.kind !== "paragraph" && close) {
      current.lines.push(raw);
      if (close.test(raw)) {
        yield current;
        current = null;
        close = null;
      }
      return;
    }
    if (!raw.trim()) {
      if (current) yield current;
      current = null;
      return;
    }
    const fence = FENCE_OPEN.exec(raw)?.[1];
    const mathClose = fence ? null : displayMathClose(raw);
    if (fence || mathClose) {
      if (current) yield current;
      if (mathClose && closesOnOpeningLine(raw, mathClose)) {
        current = null;
        yield { kind: "math", lines: [raw] };
        return;
      }
      current = { kind: fence ? "code" : "math", lines: [raw] };
      close = fence
        ? new RegExp(
            `^\\s{0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`,
          )
        : mathClose;
      return;
    }
    if (current) current.lines.push(raw);
    else current = { kind: "paragraph", lines: [raw] };
  }

  for await (const part of parts) {
    pending += part.replace(/\r\n?/g, "\n");
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      yield* line(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  }
  if (pending) yield* line(pending);
  if (current) yield current;
}

/**
 * Separates what a speech model can read verbatim from what it would read as
 * symbols: fenced code, tables, display math, and any paragraph carrying
 * inline math (the whole paragraph, so a formula is narrated in its sentence
 * rather than one request per formula). Each narrated segment carries the
 * tail of the prose before it as context.
 */
export async function* speakableSegments(
  parts: AsyncIterable<string> | Iterable<string>,
): AsyncGenerator<SpeechSegment> {
  let before = "";
  const remember = (text: string) => {
    before = `${before} ${text}`
      .replace(/\s+/g, " ")
      .trim()
      .slice(-CONTEXT_CHARS);
  };
  for await (const block of blocks(parts)) {
    const text = block.lines.join("\n");
    if (block.kind !== "paragraph") {
      yield { kind: block.kind, text, before };
      continue;
    }
    for (const part of splitTable(block.lines)) {
      const partText = part.lines.join("\n");
      if (part.kind === "table") {
        yield { kind: "table", text: partText, before };
      } else if (INLINE_MATH.test(partText)) {
        yield { kind: "math", text: partText, before };
        remember(partText);
      } else {
        yield { kind: "text", text: `${partText}\n\n` };
        remember(partText);
      }
    }
  }
}
