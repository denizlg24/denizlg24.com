import {
  type Block,
  type BlockInput,
  blockSchema,
  type RichText,
} from "@repo/schemas";
import {
  formatHref,
  markdownToRuns,
  readLink,
  runsToMarkdown,
  textRuns,
} from "./workspace-rich-text";

/*
 * Block tree ↔ markdown, lossless both ways for anything `blocksToMarkdown`
 * wrote, and a sensible reading of hand-written markdown.
 *
 * Text blocks are ordinary markdown — `#` headings, `-` / `1.` / `- [ ]` list
 * items with their children indented beneath them, `>` quotes (children after
 * a bare `>` line), fenced code, `---`, `$$` equations, `![caption](url)` —
 * each ending in a marker that carries its id and anything markdown cannot
 * say: `## Week <!-- id="a1" -->`. A line holding only a marker is an empty
 * paragraph. Inline text is `runsToMarkdown`'s, one line per block.
 *
 * Toggles are `<details>` with a `<summary>`; callouts, columns and each
 * column are fenced directives whose body is their children:
 *
 *   :::callout{id="c1" emoji="💡" color="gray"} Callout text
 *   - a child
 *   :::
 *
 * Every other type (widgets, bookmarks, files, tables, synced blocks…) is a
 * directive whose body is its remaining fields as JSON:
 *
 *   :::block{type="links" id="b2"}
 *   {"refs":["page:home"]}
 *   :::
 *
 * Hand-written markdown with no markers gets fresh ids.
 */

const LIST_TYPES = new Set(["bullet", "numbered", "todo"]);
const MARKER = /(^| )<!-- (.*) -->$/;
const DIRECTIVE_OPEN = /^:::([a-z]+)\{/;
const DIRECTIVE_CLOSE = ":::";
const DETAILS_OPEN = /^<details>/;
const DETAILS_CLOSE = "</details>";
const SUMMARY = /^<summary>(.*)<\/summary>$/;
const HEADING = /^(#{1,6})(?: (.*))?$/;
const TODO = /^[-*+] \[([ xX])\](?: (.*))?$/;
const BULLET = /^[-*+](?: (.*))?$/;
const NUMBERED = /^(\d{1,9})[.)](?: (.*))?$/;
const DIVIDER = /^(-{3,}|\*{3,}|_{3,})$/;
const FENCE = /^(`{3,}|~{3,})(.*)$/;
const LEGACY_MARKER = /^<!-- \/?block( .*)? -->$/;
const SAFE_LANGUAGE = /^[\w+#.-]*$/;

type Attrs = Record<string, unknown>;

/** JSON with `>` escaped, so no attribute can end an HTML comment early. */
function json(value: unknown): string {
  return JSON.stringify(value).replace(/>/g, "\\u003e");
}

function formatAttrs(attrs: Attrs): string {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${json(value)}`)
    .join(" ");
}

/** Reads `key=<json>` pairs from `source`, stopping at `stop` outside a value. */
function parseAttrs(
  source: string,
  stop?: string,
): { attrs: Attrs; end: number } {
  const attrs: Attrs = {};
  let i = 0;
  while (i < source.length) {
    while (source[i] === " ") i++;
    if (i >= source.length || (stop && source[i] === stop)) break;
    const eq = source.indexOf("=", i);
    if (eq < 0) break;
    const key = source.slice(i, eq).trim();
    let j = eq + 1;
    const first = source[j];
    if (first === '"') {
      j++;
      while (j < source.length && source[j] !== '"') {
        j += source[j] === "\\" ? 2 : 1;
      }
      j++;
    } else if (first === "[" || first === "{") {
      let depth = 0;
      let inString = false;
      for (; j < source.length; j++) {
        const ch = source[j];
        if (inString) {
          if (ch === "\\") j++;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "[" || ch === "{") depth++;
        else if (ch === "]" || ch === "}") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
      }
    } else {
      while (j < source.length && source[j] !== " " && source[j] !== stop) j++;
    }
    try {
      attrs[key] = JSON.parse(source.slice(eq + 1, j));
    } catch {
      attrs[key] = source.slice(eq + 1, j);
    }
    i = j;
  }
  return { attrs, end: i };
}

function stringAttr(attrs: Attrs, key: string): string | undefined {
  const value = attrs[key];
  return typeof value === "string" ? value : undefined;
}

function marker(attrs: Attrs): string {
  return `<!-- ${formatAttrs(attrs)} -->`;
}

/** `line` with its trailing marker split off. */
function splitMarker(line: string): { body: string; attrs: Attrs | null } {
  const match = MARKER.exec(line);
  if (!match) return { body: line, attrs: null };
  return {
    body: line.slice(0, match.index),
    attrs: parseAttrs(match[2] ?? "").attrs,
  };
}

function indent(text: string, by: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `${by}${line}` : line))
    .join("\n");
}

// --- rendering ---------------------------------------------------------------

function textLine(prefix: string, text: RichText, attrs: Attrs): string {
  const inline = runsToMarkdown(text);
  const head = `${prefix}${inline}`;
  return head ? `${head} ${marker(attrs)}` : marker(attrs);
}

function directive(name: string, attrs: Attrs, rest = ""): string {
  return `:::${name}{${formatAttrs(attrs)}}${rest ? ` ${rest}` : ""}`;
}

function genericDirective(block: Block): string {
  const { id, type, ...rest } = block;
  const title = "title" in rest ? rest.title : undefined;
  const fields = Object.fromEntries(
    Object.entries(rest).filter(([key]) => key !== "title"),
  );
  const head = directive("block", { type, id, title });
  const body = Object.keys(fields).length > 0 ? `\n${json(fields)}` : "";
  return `${head}${body}\n${DIRECTIVE_CLOSE}`;
}

function fenceFor(code: string): string {
  const longest = Math.max(
    0,
    ...[...code.matchAll(/`+/g)].map((match) => match[0].length),
  );
  return "`".repeat(Math.max(3, longest + 1));
}

function renderChildren(children: readonly Block[]): string {
  return children.length > 0 ? `\n${renderSequence(children)}` : "";
}

function renderBlock(block: Block, ordinal: number): string {
  const id = { id: block.id };
  switch (block.type) {
    case "paragraph":
      return textLine("", block.text, id);
    case "heading":
      return textLine(`${"#".repeat(block.level)} `, block.text, id);
    case "bullet":
      return `${textLine("- ", block.text, id)}${indent(renderChildren(block.children), "  ")}`;
    case "todo":
      return `${textLine(`- [${block.checked ? "x" : " "}] `, block.text, id)}${indent(renderChildren(block.children), "  ")}`;
    case "numbered": {
      const prefix = `${ordinal}. `;
      return `${textLine(prefix, block.text, id)}${indent(renderChildren(block.children), " ".repeat(prefix.length))}`;
    }
    case "toggle": {
      const head = `<details> ${marker({ ...id, level: block.level })}\n<summary>${runsToMarkdown(block.text)}</summary>`;
      const body =
        block.children.length > 0
          ? `\n\n${renderSequence(block.children)}\n`
          : "";
      return `${head}${body}\n${DETAILS_CLOSE}`;
    }
    case "callout": {
      const head = directive(
        "callout",
        { ...id, emoji: block.emoji, color: block.color },
        runsToMarkdown(block.text),
      );
      return `${head}${renderChildren(block.children)}\n${DIRECTIVE_CLOSE}`;
    }
    case "quote": {
      const head = textLine("> ", block.text, id);
      if (block.children.length === 0) return head;
      return `${head}\n>\n${renderSequence(block.children)
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n")}`;
    }
    case "code": {
      const fence = fenceFor(block.code);
      const safe = SAFE_LANGUAGE.test(block.language);
      const info = safe ? block.language : "";
      const attrs = safe ? id : { ...id, language: block.language };
      return `${fence}${info} ${marker(attrs)}\n${block.code}\n${fence}`;
    }
    case "divider":
      return `--- ${marker(id)}`;
    case "image":
      return `![${runsToMarkdown(block.caption)}](${formatHref(block.url)}) ${marker(id)}`;
    case "equation":
      // A line that reads as a fence or directive would end the block early.
      if (
        block.expression
          .split("\n")
          .some((line) => /^(\$\$|:::|<|`{3}|~{3})/.test(line.trim()))
      ) {
        return genericDirective(block);
      }
      return `$$ ${marker(id)}\n${block.expression}\n$$`;
    case "columns": {
      const columns = block.children
        .map(
          (column) =>
            `${directive("column", { id: column.id, width: column.width })}${renderChildren(column.children)}\n${DIRECTIVE_CLOSE}`,
        )
        .join("\n\n");
      return `${directive("columns", id)}${columns ? `\n${columns}` : ""}\n${DIRECTIVE_CLOSE}`;
    }
    default:
      return genericDirective(block);
  }
}

function renderSequence(blocks: readonly Block[]): string {
  let out = "";
  let ordinal = 0;
  blocks.forEach((block, index) => {
    const previous = blocks[index - 1];
    ordinal =
      block.type === "numbered" && previous?.type === "numbered"
        ? ordinal + 1
        : 1;
    if (index > 0) {
      out +=
        previous && LIST_TYPES.has(previous.type) && LIST_TYPES.has(block.type)
          ? "\n"
          : "\n\n";
    }
    out += renderBlock(block, ordinal);
  });
  return out;
}

export function blocksToMarkdown(blocks: readonly Block[]): string {
  return renderSequence(blocks);
}

// --- parsing -----------------------------------------------------------------

export interface MarkdownToBlocksOptions {
  newId: () => string;
  /** Read a structure that does not parse as plain text instead of refusing it. */
  lenient?: boolean;
}

export class WorkspaceMarkdownError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`Line ${line}: ${message}`);
    this.name = "WorkspaceMarkdownError";
  }
}

function isFence(line: string): boolean {
  return FENCE.test(splitMarker(line).body);
}

/** Index of the line closing the container opened at `start`, skipping code. */
function findClose(
  lines: readonly string[],
  start: number,
  opens: (line: string) => boolean,
  close: string,
): number {
  let depth = 1;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isFence(line)) {
      const fence = FENCE.exec(splitMarker(line).body)?.[1] ?? "```";
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith(fence)) i++;
      continue;
    }
    if (line === close) {
      depth--;
      if (depth === 0) return i;
    } else if (opens(line)) {
      depth++;
    }
  }
  return -1;
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start++;
  while (end > start && lines[end - 1]?.trim() === "") end--;
  return lines.slice(start, end);
}

class Parser {
  constructor(private readonly options: MarkdownToBlocksOptions) {}

  private make(candidate: Record<string, unknown>, line: number): Block {
    const parsed = blockSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new WorkspaceMarkdownError(
        line,
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      );
    }
    return parsed.data;
  }

  /** Lines kept as a paragraph of their own text, escapes and all. */
  private literal(lines: readonly string[], line: number): Block {
    return this.make(
      {
        id: this.options.newId(),
        type: "paragraph",
        text: textRuns(lines.join("\n")),
      },
      line,
    );
  }

  private id(attrs: Attrs | null): string {
    return (attrs && stringAttr(attrs, "id")) || this.options.newId();
  }

  /** Lines indented by `width` after `start` (blank lines between them too), dedented. */
  private nested(lines: readonly string[], start: number, width: number) {
    const pad = " ".repeat(width);
    let end = start;
    let last = start;
    while (end < lines.length) {
      const line = lines[end] ?? "";
      if (line.trim() === "") {
        end++;
        continue;
      }
      if (!line.startsWith(pad)) break;
      end++;
      last = end;
    }
    return {
      body: lines.slice(start, last).map((line) => line.slice(width)),
      end: last,
    };
  }

  private startsBlock(line: string): boolean {
    const { body, attrs } = splitMarker(line);
    if (body === "" && attrs) return true;
    return (
      LEGACY_MARKER.test(line) ||
      DIRECTIVE_OPEN.test(line) ||
      DETAILS_OPEN.test(line) ||
      FENCE.test(body) ||
      body.trim() === "$$" ||
      HEADING.test(body) ||
      BULLET.test(body) ||
      NUMBERED.test(body) ||
      DIVIDER.test(body.trim()) ||
      body.startsWith(">") ||
      /^!\[/.test(body)
    );
  }

  parse(lines: readonly string[], offset: number): Block[] {
    const blocks: Block[] = [];
    let i = 0;
    while (i < lines.length) {
      const raw = lines[i] ?? "";
      const lineNo = offset + i + 1;
      if (raw.trim() === "" || LEGACY_MARKER.test(raw)) {
        i++;
        continue;
      }
      const { body, attrs } = splitMarker(raw);
      const id = () => this.id(attrs);

      const directiveMatch = DIRECTIVE_OPEN.exec(raw);
      if (directiveMatch) {
        const name = directiveMatch[1] ?? "";
        const head = parseAttrs(raw.slice(directiveMatch[0].length), "}");
        const rest = raw
          .slice(directiveMatch[0].length + head.end + 1)
          .replace(/^ /, "");
        const close = findClose(
          lines,
          i,
          (line) => DIRECTIVE_OPEN.test(line),
          DIRECTIVE_CLOSE,
        );
        if (close < 0) {
          if (!this.options.lenient) {
            throw new WorkspaceMarkdownError(
              lineNo,
              `Unclosed :::${name} directive`,
            );
          }
          blocks.push(this.literal([raw], lineNo));
          i++;
          continue;
        }
        const inner = lines.slice(i + 1, close);
        try {
          blocks.push(
            this.directive(
              name,
              head.attrs,
              rest,
              inner,
              offset + i + 1,
              lineNo,
            ),
          );
        } catch (error) {
          if (
            !this.options.lenient ||
            !(error instanceof WorkspaceMarkdownError)
          ) {
            throw error;
          }
          blocks.push(this.literal(lines.slice(i, close + 1), lineNo));
        }
        i = close + 1;
        continue;
      }

      if (DETAILS_OPEN.test(raw)) {
        const close = findClose(
          lines,
          i,
          (line) => DETAILS_OPEN.test(line),
          DETAILS_CLOSE,
        );
        if (close < 0) {
          if (!this.options.lenient) {
            throw new WorkspaceMarkdownError(lineNo, "Unclosed <details>");
          }
          blocks.push(this.literal([raw], lineNo));
          i++;
          continue;
        }
        const sameLine = body.replace(DETAILS_OPEN, "").trim();
        const inner = lines.slice(i + 1, close);
        let summary = SUMMARY.exec(sameLine)?.[1];
        let childStart = 0;
        if (summary === undefined) {
          const first = inner.findIndex((line) => line.trim() !== "");
          const match =
            first >= 0 ? SUMMARY.exec((inner[first] ?? "").trim()) : null;
          if (match) {
            summary = match[1];
            childStart = first + 1;
          }
        }
        const level = attrs?.level;
        blocks.push(
          this.make(
            {
              id: id(),
              type: "toggle",
              text: markdownToRuns(summary ?? ""),
              ...(level === 1 || level === 2 || level === 3 ? { level } : {}),
              children: this.parse(
                inner.slice(childStart),
                offset + i + 1 + childStart,
              ),
            },
            lineNo,
          ),
        );
        i = close + 1;
        continue;
      }

      const fence = FENCE.exec(body);
      if (fence) {
        const mark = fence[1] ?? "```";
        const closes = (line: string) => {
          const trimmed = line.trim();
          return (
            trimmed.length >= mark.length &&
            trimmed === (mark[0] ?? "`").repeat(trimmed.length)
          );
        };
        let end = i + 1;
        while (end < lines.length && !closes(lines[end] ?? "")) end++;
        const language =
          stringAttr(attrs ?? {}, "language") ?? (fence[2] ?? "").trim();
        blocks.push(
          this.make(
            {
              id: id(),
              type: "code",
              code: lines.slice(i + 1, end).join("\n"),
              language,
            },
            lineNo,
          ),
        );
        i = end + 1;
        continue;
      }

      if (body.trim() === "$$") {
        let end = i + 1;
        while (end < lines.length && (lines[end] ?? "").trim() !== "$$") end++;
        blocks.push(
          this.make(
            {
              id: id(),
              type: "equation",
              expression: lines.slice(i + 1, end).join("\n"),
            },
            lineNo,
          ),
        );
        i = end + 1;
        continue;
      }

      if (body === "" && attrs) {
        blocks.push(
          this.make({ id: id(), type: "paragraph", text: [] }, lineNo),
        );
        i++;
        continue;
      }

      const heading = HEADING.exec(body);
      if (heading) {
        const level = Math.min(3, heading[1]?.length ?? 1);
        blocks.push(
          this.make(
            {
              id: id(),
              type: "heading",
              level,
              text: markdownToRuns(heading[2] ?? ""),
            },
            lineNo,
          ),
        );
        i++;
        continue;
      }

      const todo = TODO.exec(body);
      const numbered = todo ? null : NUMBERED.exec(body);
      const bullet =
        todo || numbered || DIVIDER.test(body.trim())
          ? null
          : BULLET.exec(body);
      if (todo || numbered || bullet) {
        const width = numbered ? (numbered[1]?.length ?? 1) + 2 : 2;
        const children = this.nested(lines, i + 1, width);
        const text = markdownToRuns(
          (todo ? todo[2] : numbered ? numbered[2] : bullet?.[1]) ?? "",
        );
        const candidate: BlockInput = todo
          ? {
              id: id(),
              type: "todo",
              text,
              checked: todo[1] !== " ",
              children: [],
            }
          : numbered
            ? { id: id(), type: "numbered", text, children: [] }
            : { id: id(), type: "bullet", text, children: [] };
        blocks.push(
          this.make(
            {
              ...candidate,
              children: this.parse(children.body, offset + i + 1),
            },
            lineNo,
          ),
        );
        i = children.end;
        continue;
      }

      if (DIVIDER.test(body.trim())) {
        blocks.push(this.make({ id: id(), type: "divider" }, lineNo));
        i++;
        continue;
      }

      if (body.startsWith(">")) {
        let end = i;
        while (end < lines.length && (lines[end] ?? "").startsWith(">")) end++;
        const inner = lines.slice(i, end).map((line, index) => {
          const unquoted = line.replace(/^> ?/, "");
          return index === 0 ? splitMarker(unquoted).body : unquoted;
        });
        const blank = inner.findIndex((line) => line.trim() === "");
        const textLines = blank < 0 ? inner : inner.slice(0, blank);
        const childLines = blank < 0 ? [] : inner.slice(blank + 1);
        const quoteAttrs = splitMarker(raw.replace(/^> ?/, "")).attrs ?? attrs;
        blocks.push(
          this.make(
            {
              id: this.id(quoteAttrs),
              type: "quote",
              text: markdownToRuns(textLines.join("\n")),
              children: this.parse(
                childLines,
                offset + i + 1 + (blank < 0 ? 0 : blank + 1),
              ),
            },
            lineNo,
          ),
        );
        i = end;
        continue;
      }

      const image = /^!\[/.test(body) ? readImage(body) : null;
      if (image) {
        blocks.push(
          this.make(
            {
              id: id(),
              type: "image",
              url: image.url,
              caption: markdownToRuns(image.caption),
            },
            lineNo,
          ),
        );
        i++;
        continue;
      }

      const paragraph = [body];
      let end = i + 1;
      while (end < lines.length) {
        const line = lines[end] ?? "";
        if (line.trim() === "" || this.startsBlock(line)) break;
        paragraph.push(line);
        end++;
      }
      blocks.push(
        this.make(
          {
            id: id(),
            type: "paragraph",
            text: markdownToRuns(trimBlankEdges(paragraph).join("\n")),
          },
          lineNo,
        ),
      );
      i = end;
    }
    return blocks;
  }

  private directive(
    name: string,
    attrs: Attrs,
    rest: string,
    inner: string[],
    offset: number,
    lineNo: number,
  ): Block {
    const id = this.id(attrs);
    switch (name) {
      case "callout":
        return this.make(
          {
            id,
            type: "callout",
            text: markdownToRuns(rest),
            ...(typeof attrs.emoji === "string" ? { emoji: attrs.emoji } : {}),
            ...(typeof attrs.color === "string" ? { color: attrs.color } : {}),
            children: this.parse(inner, offset),
          },
          lineNo,
        );
      case "columns": {
        const children = this.parse(inner, offset);
        const columns = children.filter((child) => child.type === "column");
        if (columns.length !== children.length) {
          throw new WorkspaceMarkdownError(
            lineNo,
            "A :::columns directive holds only :::column directives",
          );
        }
        return this.make({ id, type: "columns", children: columns }, lineNo);
      }
      case "column": {
        const width = typeof attrs.width === "number" ? attrs.width : 0.5;
        return this.make(
          { id, type: "column", width, children: this.parse(inner, offset) },
          lineNo,
        );
      }
      case "block": {
        const bodyText = inner.join("\n").trim();
        let fields: Attrs = {};
        if (bodyText) {
          try {
            const parsed: unknown = JSON.parse(bodyText);
            if (
              typeof parsed !== "object" ||
              !parsed ||
              Array.isArray(parsed)
            ) {
              throw new Error("not an object");
            }
            fields = { ...parsed };
          } catch {
            throw new WorkspaceMarkdownError(
              lineNo + 1,
              "A directive's body must be one JSON object",
            );
          }
        }
        const title = stringAttr(attrs, "title");
        return this.make(
          {
            ...fields,
            id,
            type: attrs.type,
            ...(title !== undefined ? { title } : {}),
          },
          lineNo,
        );
      }
      default:
        throw new WorkspaceMarkdownError(
          lineNo,
          `Unknown directive :::${name}`,
        );
    }
  }
}

/** `![caption](url)` filling the whole line, or null. */
function readImage(line: string): { caption: string; url: string } | null {
  const link = readLink(line, 1);
  return link && link.end === line.length
    ? { caption: link.label, url: link.href }
    : null;
}

export function markdownToBlocks(
  markdown: string,
  options: MarkdownToBlocksOptions,
): Block[] {
  return new Parser(options).parse(markdown.split("\n"), 0);
}
