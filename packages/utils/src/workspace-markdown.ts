import {
  type Block,
  type BlockSpan,
  blockSchema,
  blockSpanSchema,
  type TodoItem,
} from "@repo/schemas";

/*
 * Blocks ↔ markdown, lossless both ways for anything `blocksToMarkdown` wrote.
 *
 * Heading, text and todo blocks are plain markdown preceded by a marker that
 * carries what markdown cannot (id, span, title, todo item ids):
 *
 *   <!-- block type="heading" id="a1" span=3 -->
 *   ## Heading
 *
 * A text block's body is verbatim markdown closed by `<!-- /block -->`, so
 * anything written after it becomes new blocks; a line inside it that would
 * read as a marker or directive is escaped with a leading backslash.
 *
 * Every other type is a directive whose body is the remaining fields as JSON:
 *
 *   :::block{type="links" id="b2" span=6}
 *   {"refs":["page:home"]}
 *   :::
 *
 * Markdown written by hand (no markers) is split into headings, todo lists,
 * `---` dividers and paragraphs, each given a fresh id.
 */

const DEFAULT_SPAN: BlockSpan = 6;
const MARKER = /^<!-- block( .*)? -->$/;
const TEXT_END = "<!-- /block -->";
const DIRECTIVE = /^:::block\{(.*)\}$/;
const ESCAPABLE = /^\\*(<!-- \/?block|:::block\{)/;
const ESCAPED = /^\\+(<!-- \/?block|:::block\{)/;
const HEADING = /^#{1,6}(?: (.*))?$/;
const TODO = /^[-*] \[([ xX])\](?: (.*))?$/;
const DIVIDER = /^(-{3,}|\*{3,}|_{3,})$/;

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

/** Reads `key=<json>` pairs; a value ends where its JSON does. */
function parseAttrs(source: string): Attrs {
  const attrs: Attrs = {};
  let i = 0;
  while (i < source.length) {
    while (source[i] === " ") i++;
    if (i >= source.length) break;
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
      while (j < source.length && source[j] !== " ") j++;
    }
    try {
      attrs[key] = JSON.parse(source.slice(eq + 1, j));
    } catch {
      attrs[key] = source.slice(eq + 1, j);
    }
    i = j;
  }
  return attrs;
}

function escapeLine(line: string): string {
  return ESCAPABLE.test(line) ? `\\${line}` : line;
}

function unescapeLine(line: string): string {
  return ESCAPED.test(line) ? line.slice(1) : line;
}

function isSingleLine(text: string): boolean {
  return !/[\r\n]/.test(text);
}

function markerAttrs(block: Block): Attrs {
  return {
    type: block.type,
    id: block.id,
    span: block.span,
    ...(block.title !== undefined ? { title: block.title } : {}),
  };
}

function marker(attrs: Attrs): string {
  return `<!-- block ${formatAttrs(attrs)} -->`;
}

function directive(block: Block): string {
  const { id, type, span, title, ...rest } = block;
  const head = `:::block{${formatAttrs({ type, id, span, title })}}`;
  const body = Object.keys(rest).length > 0 ? `\n${json(rest)}` : "";
  return `${head}${body}\n:::`;
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case "heading":
      if (!isSingleLine(block.text)) return directive(block);
      return `${marker(markerAttrs(block))}\n## ${block.text}`;
    case "text":
      return `${marker(markerAttrs(block))}\n${block.markdown
        .split("\n")
        .map(escapeLine)
        .join("\n")}\n${TEXT_END}`;
    case "todo": {
      if (block.items.length === 0) return directive(block);
      if (!block.items.every((item) => isSingleLine(item.text))) {
        return directive(block);
      }
      const lines = block.items.map(
        (item) => `- [${item.done ? "x" : " "}] ${item.text}`,
      );
      return `${marker({ ...markerAttrs(block), items: block.items.map((item) => item.id) })}\n${lines.join("\n")}`;
    }
    default:
      return directive(block);
  }
}

export function blocksToMarkdown(blocks: readonly Block[]): string {
  return blocks.map(renderBlock).join("\n\n");
}

export interface MarkdownToBlocksOptions {
  newId: () => string;
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

function spanOf(value: unknown): BlockSpan {
  const parsed = blockSpanSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SPAN;
}

function stringAttr(attrs: Attrs, key: string): string | undefined {
  const value = attrs[key];
  return typeof value === "string" ? value : undefined;
}

function isBlockStart(line: string): boolean {
  return MARKER.test(line) || DIRECTIVE.test(line);
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start++;
  while (end > start && lines[end - 1]?.trim() === "") end--;
  return lines.slice(start, end);
}

export function markdownToBlocks(
  markdown: string,
  options: MarkdownToBlocksOptions,
): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  const base = (attrs: Attrs | null) => ({
    id: (attrs && stringAttr(attrs, "id")) || options.newId(),
    span: attrs ? spanOf(attrs.span) : DEFAULT_SPAN,
    ...(attrs && stringAttr(attrs, "title") !== undefined
      ? { title: stringAttr(attrs, "title") }
      : {}),
  });

  let paragraph: string[] = [];
  const flushParagraph = () => {
    const body = trimBlankEdges(paragraph);
    paragraph = [];
    if (body.length === 0) return;
    blocks.push({ ...base(null), type: "text", markdown: body.join("\n") });
  };

  const readTodos = (start: number): { items: TodoItem[]; end: number } => {
    const items: TodoItem[] = [];
    let i = start;
    for (; i < lines.length; i++) {
      const match = TODO.exec(lines[i] ?? "");
      if (!match) break;
      items.push({
        id: options.newId(),
        text: match[2] ?? "",
        done: match[1] !== " ",
      });
    }
    return { items, end: i };
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    const directiveMatch = DIRECTIVE.exec(line);
    if (directiveMatch) {
      flushParagraph();
      const attrs = parseAttrs(directiveMatch[1] ?? "");
      const close = lines.indexOf(":::", i + 1);
      if (close < 0) {
        throw new WorkspaceMarkdownError(i + 1, "Unclosed :::block directive");
      }
      const bodyText = lines
        .slice(i + 1, close)
        .join("\n")
        .trim();
      let rest: Attrs = {};
      if (bodyText) {
        try {
          const parsed: unknown = JSON.parse(bodyText);
          if (typeof parsed === "object" && parsed && !Array.isArray(parsed)) {
            rest = { ...parsed };
          } else {
            throw new Error("not an object");
          }
        } catch {
          throw new WorkspaceMarkdownError(
            i + 2,
            "A directive's body must be one JSON object",
          );
        }
      }
      const parsed = blockSchema.safeParse({
        ...rest,
        ...base(attrs),
        type: attrs.type,
      });
      if (!parsed.success) {
        throw new WorkspaceMarkdownError(
          i + 1,
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        );
      }
      blocks.push(parsed.data);
      i = close + 1;
      continue;
    }

    const markerMatch = MARKER.exec(line);
    if (markerMatch) {
      flushParagraph();
      const attrs = parseAttrs(markerMatch[1] ?? "");
      const next = lines[i + 1];
      // A marker without a type (written by hand) takes the next line's.
      const declared = stringAttr(attrs, "type");
      const heading =
        next === undefined || (declared && declared !== "heading")
          ? null
          : HEADING.exec(next);
      const todo =
        next === undefined || (declared && declared !== "todo")
          ? null
          : TODO.exec(next);
      if (heading) {
        blocks.push({
          ...base(attrs),
          type: "heading",
          text: heading[1] ?? "",
        });
        i += 2;
      } else if (todo) {
        const { items, end } = readTodos(i + 1);
        const ids = Array.isArray(attrs.items) ? attrs.items : [];
        items.forEach((item, index) => {
          const id = ids[index];
          if (typeof id === "string") item.id = id;
        });
        blocks.push({ ...base(attrs), type: "todo", items });
        i = end;
      } else {
        let end = i + 1;
        while (
          end < lines.length &&
          lines[end] !== TEXT_END &&
          !isBlockStart(lines[end] ?? "")
        ) {
          end++;
        }
        const closed = lines[end] === TEXT_END;
        const body = lines.slice(i + 1, end);
        // Unclosed (written by hand): the blank line before the next block is a separator.
        if (!closed) {
          while (body.length > 0 && body.at(-1)?.trim() === "") body.pop();
        }
        blocks.push({
          ...base(attrs),
          type: "text",
          markdown: body.map(unescapeLine).join("\n"),
        });
        i = closed ? end + 1 : end;
      }
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ ...base(null), type: "heading", text: heading[1] ?? "" });
      i++;
      continue;
    }

    if (TODO.test(line)) {
      flushParagraph();
      const { items, end } = readTodos(i);
      blocks.push({ ...base(null), type: "todo", items });
      i = end;
      continue;
    }

    if (DIVIDER.test(line.trim())) {
      flushParagraph();
      blocks.push({ ...base(null), type: "divider" });
      i++;
      continue;
    }

    if (line.trim() === "") {
      // A blank line ends a paragraph only when what follows is a new block.
      paragraph.push(line);
      i++;
      continue;
    }
    paragraph.push(unescapeLine(line));
    i++;
  }
  flushParagraph();
  return blocks;
}
