import {
  type InlineRun,
  mentionKindSchema,
  type RichText,
  type TextRun,
} from "@repo/schemas";

/*
 * Rich text runs ↔ one line of inline markdown, lossless for anything
 * `runsToMarkdown` wrote and forgiving of hand-written markdown.
 *
 * Every run is written on its own, marks nested link → bold → italic →
 * strike → code: `[**_x_**](href)` is not produced, `[***x***](href)` is.
 * A newline inside text is `<br>`; whitespace at either end of the line is a
 * numeric entity, so indentation and trimming cannot eat it. Mentions are
 * links whose text starts with `@`: `[@Name](person:id)`, `[@](page:id)`,
 * `[@2026-10-29](date:2026-10-29)`, any other record `[@Title](note:id)`
 * (every `MentionKind`). A real link whose text starts with `@`
 * escapes it.
 */

type Marks = Omit<TextRun, "type" | "text">;

const MARK_KEYS = ["bold", "italic", "strike", "code", "link"] as const;
const PUNCTUATION = /[!-/:-@[-`{-~]/;
const MENTION_HREF = /^([a-z][a-z-]*):(.+)$/;

function sameMarks(a: Marks, b: Marks): boolean {
  return MARK_KEYS.every((key) => a[key] === b[key]);
}

function marksOf(run: TextRun): Marks {
  const marks: Marks = {};
  if (run.bold) marks.bold = true;
  if (run.italic) marks.italic = true;
  if (run.strike) marks.strike = true;
  if (run.code) marks.code = true;
  if (run.link) marks.link = run.link;
  return marks;
}

/** Adjacent text runs with the same marks merged, empty ones dropped. */
export function normalizeRuns(runs: readonly InlineRun[]): RichText {
  const out: RichText = [];
  for (const run of runs) {
    if (run.type === "mention") {
      out.push(run);
      continue;
    }
    if (!run.text) continue;
    const last = out.at(-1);
    if (last?.type === "text" && sameMarks(marksOf(last), marksOf(run))) {
      out[out.length - 1] = { ...last, text: last.text + run.text };
    } else {
      out.push({ type: "text", text: run.text, ...marksOf(run) });
    }
  }
  return out;
}

export function textRuns(text: string): RichText {
  return text ? [{ type: "text", text }] : [];
}

/** What the runs read as with every mark dropped. */
export function plainText(runs: readonly InlineRun[]): string {
  return runs
    .map((run) => (run.type === "text" ? run.text : `@${run.label ?? run.id}`))
    .join("");
}

function escapeText(text: string): string {
  return text
    .replace(/[\\`*_~[\]<&]/g, (ch) => `\\${ch}`)
    .replace(/\n/g, "<br>")
    .replace(/\r/g, "&#13;");
}

function escapeCode(text: string): string {
  return text
    .replace(/[\\`<&]/g, (ch) => `\\${ch}`)
    .replace(/\n/g, "<br>")
    .replace(/\r/g, "&#13;");
}

/** An href as a link destination: bare when it can be, `<…>` otherwise. */
export function formatHref(href: string): string {
  if (href && !/[\s()<>\\]/.test(href)) return href;
  return `<${href.replace(/[\\<>]/g, (ch) => `\\${ch}`)}>`;
}

function renderRun(run: InlineRun, first: boolean): string {
  if (run.type === "mention") {
    return `[@${escapeText(run.label ?? "")}](${formatHref(`${run.kind}:${run.id}`)})`;
  }
  let out = run.code ? `\`${escapeCode(run.text)}\`` : escapeText(run.text);
  if (run.strike) out = `~~${out}~~`;
  // `* text` opening a line would read as a list item.
  const underscore = first && !run.bold && !run.link && /^[ \t]/.test(out);
  if (run.italic) out = underscore ? `_${out}_` : `*${out}*`;
  if (run.bold) out = `**${out}**`;
  if (run.link) {
    const inner = out.startsWith("@") ? `\\${out}` : out;
    out = `[${inner}](${formatHref(run.link)})`;
  }
  return out;
}

/** Whitespace at either end as entities, so the line keeps it. */
function protectEdges(line: string): string {
  const entity = (ch: string) => `&#${ch.charCodeAt(0)};`;
  return line
    .replace(/^[ \t]+/, (lead) => [...lead].map(entity).join(""))
    .replace(/[ \t]+$/, (tail) => [...tail].map(entity).join(""));
}

/**
 * Escapes what would read as block syntax at the start of a line: headings,
 * list markers, quotes, directives, fences, dividers, images, equations.
 */
function protectLineStart(line: string): string {
  const ordered = /^(\d+)([.)])/.exec(line);
  if (ordered)
    return `${ordered[1]}\\${ordered[2]}${line.slice(ordered[0].length)}`;
  return /^[#\-+>:!$|=]/.test(line) ? `\\${line}` : line;
}

export function runsToMarkdown(runs: readonly InlineRun[]): string {
  return protectLineStart(
    protectEdges(
      normalizeRuns(runs)
        .map((run, index) => renderRun(run, index === 0))
        .join(""),
    ),
  );
}

// --- parsing ----------------------------------------------------------------

function decodeEntity(source: string, at: number): [string, number] | null {
  const match = /^&(#\d{1,7}|#x[0-9a-fA-F]{1,6}|amp|lt|gt|quot|nbsp);/.exec(
    source.slice(at),
  );
  if (!match?.[1]) return null;
  const name = match[1];
  const text =
    name === "amp"
      ? "&"
      : name === "lt"
        ? "<"
        : name === "gt"
          ? ">"
          : name === "quot"
            ? '"'
            : name === "nbsp"
              ? " "
              : String.fromCodePoint(
                  name.startsWith("#x")
                    ? Number.parseInt(name.slice(2), 16)
                    : Number.parseInt(name.slice(1), 10),
                );
  return [text, at + match[0].length];
}

/** Reads a link destination at `(`; returns the href and the index after `)`. */
function readHref(source: string, at: number): [string, number] | null {
  if (source[at] !== "(") return null;
  let i = at + 1;
  let href = "";
  if (source[i] === "<") {
    i++;
    while (i < source.length && source[i] !== ">") {
      if (source[i] === "\\" && i + 1 < source.length) i++;
      href += source[i];
      i++;
    }
    if (source[i] !== ">" || source[i + 1] !== ")") return null;
    return [href, i + 2];
  }
  let depth = 0;
  while (i < source.length) {
    const ch = source[i];
    if (
      ch === "\\" &&
      i + 1 < source.length &&
      PUNCTUATION.test(source[i + 1] ?? "")
    ) {
      href += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      if (depth === 0) return [href, i + 1];
      depth--;
    }
    if (ch === " ") return null;
    href += ch;
    i++;
  }
  return null;
}

interface Parsed {
  runs: InlineRun[];
  end: number;
  closed: boolean;
}

/**
 * Parses inline markdown from `at` until `closer` (when given) is reached.
 * The closer is checked before anything opens, so `*a***b**` reads as an
 * italic `a` then a bold `b`, the way `runsToMarkdown` writes it.
 */
function parseInline(
  source: string,
  at: number,
  marks: Marks,
  closer: string | null,
): Parsed {
  const runs: InlineRun[] = [];
  let text = "";
  const flush = () => {
    if (text) runs.push({ type: "text", text, ...marks });
    text = "";
  };
  let i = at;
  while (i < source.length) {
    if (closer && source.startsWith(closer, i)) {
      flush();
      return { runs, end: i + closer.length, closed: true };
    }
    const ch = source[i] ?? "";
    const next = source[i + 1] ?? "";
    if (ch === "\\" && PUNCTUATION.test(next)) {
      text += next;
      i += 2;
      continue;
    }
    if (ch === "&") {
      const entity = decodeEntity(source, i);
      if (entity) {
        text += entity[0];
        i = entity[1];
        continue;
      }
    }
    if (source.startsWith("<br>", i) || source.startsWith("<br/>", i)) {
      text += "\n";
      i += source.startsWith("<br>", i) ? 4 : 5;
      continue;
    }
    if (ch === "`") {
      let fence = 0;
      while (source[i + fence] === "`") fence++;
      let j = i + fence;
      let code = "";
      let closed = false;
      while (j < source.length) {
        if (source[j] === "\\" && /[\\`<&]/.test(source[j + 1] ?? "")) {
          code += source[j + 1];
          j += 2;
          continue;
        }
        if (source.startsWith("<br>", j)) {
          code += "\n";
          j += 4;
          continue;
        }
        if (source[j] === "&") {
          const entity = decodeEntity(source, j);
          if (entity) {
            code += entity[0];
            j = entity[1];
            continue;
          }
        }
        if (source[j] === "`") {
          let run = 0;
          while (source[j + run] === "`") run++;
          if (run === fence) {
            closed = true;
            j += run;
            break;
          }
          code += "`".repeat(run);
          j += run;
          continue;
        }
        code += source[j];
        j++;
      }
      if (closed && code) {
        flush();
        runs.push({ type: "text", text: code, ...marks, code: true });
        i = j;
        continue;
      }
      text += "`".repeat(fence);
      i += fence;
      continue;
    }
    const emphasis = source.startsWith("**", i)
      ? "**"
      : source.startsWith("__", i)
        ? "__"
        : source.startsWith("~~", i)
          ? "~~"
          : ch === "*" || ch === "_"
            ? ch
            : null;
    if (emphasis) {
      const before = source[i - 1] ?? "";
      const intraword = emphasis.startsWith("_") && /[A-Za-z0-9]/.test(before);
      if (!intraword) {
        const mark: Marks =
          emphasis === "~~"
            ? { strike: true }
            : emphasis.length === 2
              ? { bold: true }
              : { italic: true };
        const inner = parseInline(
          source,
          i + emphasis.length,
          { ...marks, ...mark },
          emphasis,
        );
        if (inner.closed && inner.runs.length > 0) {
          flush();
          runs.push(...inner.runs);
          i = inner.end;
          continue;
        }
      }
      text += emphasis;
      i += emphasis.length;
      continue;
    }
    if (ch === "[") {
      const inner = parseInline(source, i + 1, {}, "]");
      const href = inner.closed ? readHref(source, inner.end) : null;
      if (href) {
        flush();
        const label = source.slice(i + 1, inner.end - 1);
        const mention = MENTION_HREF.exec(href[0]);
        const kind = mentionKindSchema.safeParse(mention?.[1]);
        if (label.startsWith("@") && kind.success && mention?.[2]) {
          const name = plainText(parseInline(label.slice(1), 0, {}, null).runs);
          runs.push({
            type: "mention",
            kind: kind.data,
            id: mention[2],
            ...(name ? { label: name } : {}),
          });
        } else {
          for (const run of inner.runs) {
            if (run.type === "mention") runs.push(run);
            else
              runs.push({ ...run, ...marks, ...marksOf(run), link: href[0] });
          }
        }
        i = href[1];
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return { runs, end: i, closed: closer === null };
}

/** `[label](href)` at `at`: the label's raw markdown, the href and where it ends. */
export function readLink(
  source: string,
  at: number,
): { label: string; href: string; end: number } | null {
  if (source[at] !== "[") return null;
  const inner = parseInline(source, at + 1, {}, "]");
  if (!inner.closed) return null;
  const href = readHref(source, inner.end);
  if (!href) return null;
  return {
    label: source.slice(at + 1, inner.end - 1),
    href: href[0],
    end: href[1],
  };
}

/** One line (or several, joined with `\n`) of inline markdown as runs. */
export function markdownToRuns(source: string): RichText {
  const trimmed = source.replace(/^[ \t]+|[ \t]+$/g, "");
  return normalizeRuns(parseInline(trimmed, 0, {}, null).runs);
}
