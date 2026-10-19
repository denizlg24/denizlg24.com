import type {
  MacrosRecipeBlock,
  MacrosRecipeInline,
  MacrosRecipeStep,
} from "@repo/schemas/macros";

type Marks = Omit<MacrosRecipeInline, "text">;

function sameMarks(left: Marks, right: Marks) {
  return (
    Boolean(left.bold) === Boolean(right.bold) &&
    Boolean(left.italic) === Boolean(right.italic) &&
    left.href === right.href
  );
}

function inline(text: string, marks: Marks): MacrosRecipeInline {
  return {
    text,
    ...(marks.bold ? { bold: true } : {}),
    ...(marks.italic ? { italic: true } : {}),
    ...(marks.href ? { href: marks.href } : {}),
  };
}

/** Drops empty runs and merges neighbours that carry the same marks. */
export function normalizeInlines(
  content: readonly MacrosRecipeInline[],
): MacrosRecipeInline[] {
  const out: MacrosRecipeInline[] = [];
  for (const run of content) {
    if (!run.text) continue;
    const previous = out.at(-1);
    if (previous && sameMarks(previous, run)) {
      out[out.length - 1] = inline(previous.text + run.text, previous);
    } else {
      out.push(inline(run.text, run));
    }
  }
  const first = out[0];
  if (first) out[0] = inline(first.text.trimStart(), first);
  const last = out.at(-1);
  if (last) out[out.length - 1] = inline(last.text.trimEnd(), last);
  return out.filter((run) => run.text);
}

export function inlinesToText(content: readonly MacrosRecipeInline[]) {
  return content.map((run) => run.text).join("");
}

/**
 * The stored shape: response-only fields removed, empty blocks dropped. Both
 * clients may send half-edited drafts, so the server runs this on every save.
 */
export function normalizeBlocks(
  blocks: readonly MacrosRecipeBlock[],
): MacrosRecipeBlock[] {
  const out: MacrosRecipeBlock[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
      case "quote": {
        const content = normalizeInlines(block.content);
        if (content.length) out.push({ type: block.type, content });
        break;
      }
      case "heading": {
        const text = block.text.trim();
        if (text) out.push({ type: "heading", text });
        break;
      }
      case "list": {
        const items = block.items
          .map(normalizeInlines)
          .filter((item) => item.length);
        if (items.length)
          out.push({ type: "list", ordered: block.ordered, items });
        break;
      }
      case "image": {
        const caption = block.caption?.trim();
        out.push({
          type: "image",
          imageKey: block.imageKey,
          ...(caption ? { caption } : {}),
        });
        break;
      }
    }
  }
  return out;
}

export function normalizeSteps(
  steps: readonly MacrosRecipeStep[],
): MacrosRecipeStep[] {
  return steps
    .map((step) => ({
      title: step.title.trim(),
      blocks: normalizeBlocks(step.blocks),
    }))
    .filter((step) => step.title || step.blocks.length);
}

export function blocksToText(blocks: readonly MacrosRecipeBlock[]) {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "paragraph":
        case "quote":
          return inlinesToText(block.content);
        case "heading":
          return block.text;
        case "list":
          return block.items.map(inlinesToText).join("\n");
        case "image":
          return block.caption ?? "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

export function recipeImageKeys(article: {
  coverImageKey?: string | null;
  story?: readonly MacrosRecipeBlock[];
  steps?: readonly MacrosRecipeStep[];
}) {
  const keys = new Set<string>();
  if (article.coverImageKey) keys.add(article.coverImageKey);
  const blocks = [
    ...(article.story ?? []),
    ...(article.steps ?? []).flatMap((step) => step.blocks),
  ];
  for (const block of blocks) {
    if (block.type === "image") keys.add(block.imageKey);
  }
  return [...keys];
}

export function hasWrittenStep(steps: readonly MacrosRecipeStep[]) {
  return steps.some((step) => blocksToText(step.blocks).trim());
}

export function readingMinutes(article: {
  description?: string | null;
  story?: readonly MacrosRecipeBlock[];
  steps?: readonly MacrosRecipeStep[];
}) {
  const text = [
    article.description ?? "",
    blocksToText(article.story ?? []),
    ...(article.steps ?? []).flatMap((step) => [
      step.title,
      blocksToText(step.blocks),
    ]),
  ].join(" ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

const ESCAPABLE = /[\\*_[\]]/g;

function escapeMarkdown(text: string) {
  return text.replace(ESCAPABLE, (character) => `\\${character}`);
}

/**
 * The phone edits rich text in a plain text field: **bold**, _italic_ and
 * [text](https://…). Only those three marks exist, so the syntax stays small
 * enough to round-trip exactly.
 */
export function inlinesToMarkdown(content: readonly MacrosRecipeInline[]) {
  return normalizeInlines(content)
    .map((run) => {
      let text = escapeMarkdown(run.text);
      if (run.italic) text = `_${text}_`;
      if (run.bold) text = `**${text}**`;
      if (run.href) text = `[${text}](${run.href})`;
      return text;
    })
    .join("");
}

const WORD = /[\p{L}\p{N}]/u;

function findClosing(source: string, marker: string, from: number) {
  for (let index = from; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (!source.startsWith(marker, index)) continue;
    // snake_case and 2_000 stay literal: an italic edge must not touch a word.
    if (marker === "_" && WORD.test(source[index + 1] ?? "")) continue;
    return index;
  }
  return -1;
}

function parseRuns(source: string, marks: Marks): MacrosRecipeInline[] {
  const out: MacrosRecipeInline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push(inline(buffer, marks));
    buffer = "";
  };
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? "";
    if (character === "\\" && index + 1 < source.length) {
      buffer += source[index + 1];
      index += 2;
      continue;
    }
    if (source.startsWith("**", index)) {
      const end = findClosing(source, "**", index + 2);
      if (end > index + 2) {
        flush();
        out.push(
          ...parseRuns(source.slice(index + 2, end), { ...marks, bold: true }),
        );
        index = end + 2;
        continue;
      }
    } else if (character === "_" && !WORD.test(source[index - 1] ?? "")) {
      const end = findClosing(source, "_", index + 1);
      if (end > index + 1) {
        flush();
        out.push(
          ...parseRuns(source.slice(index + 1, end), {
            ...marks,
            italic: true,
          }),
        );
        index = end + 1;
        continue;
      }
    } else if (character === "[" && !marks.href) {
      const close = findClosing(source, "]", index + 1);
      const link =
        close > index + 1 && source[close + 1] === "("
          ? /^\((https?:\/\/[^\s)]+)\)/i.exec(source.slice(close + 1))
          : null;
      if (link?.[1]) {
        flush();
        out.push(
          ...parseRuns(source.slice(index + 1, close), {
            ...marks,
            href: link[1],
          }),
        );
        index = close + 1 + link[0].length;
        continue;
      }
    }
    buffer += character;
    index += 1;
  }
  flush();
  return out;
}

export function markdownToInlines(source: string): MacrosRecipeInline[] {
  return normalizeInlines(parseRuns(source, {}));
}
