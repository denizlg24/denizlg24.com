import {
  type Block,
  type BlockOf,
  type BlockType,
  blockSchema,
  type HeadingLevel,
  type InlineRun,
  isContainer,
  isTextBlock,
  mentionKindSchema,
  type RichText,
  type TextRun,
} from "@repo/schemas";
import {
  normalizeRuns,
  plainText,
  textRuns,
} from "@repo/utils/workspace-rich-text";
import type { JSONContent } from "@tiptap/core";
import { newId } from "../seed";

/*
 * Our block tree ↔ the editor's ProseMirror JSON. Nothing but this file and
 * the editor knows ProseMirror's shape; the store, the server and agents see
 * blocks.
 *
 * Every block is one node carrying its id in `attrs.id`, except list items,
 * which ProseMirror wants wrapped: consecutive bullets, numbered items and
 * to-dos share one bulletList / orderedList / taskList. A text-bearing
 * container (list item, toggle, callout, quote) holds its own text as a
 * first paragraph — the "text slot", whose id means nothing — and its
 * children after it. Code excludes every other mark in the editor, so a code
 * run keeps none here either. Anything with no text to edit (widgets, media,
 * tables, synced blocks…) is one `atomBlock` node with the block's fields in
 * `attrs.data`.
 */

const LIST_WRAPPER: Partial<Record<BlockType, string>> = {
  bullet: "bulletList",
  numbered: "orderedList",
  todo: "taskList",
};

function marksOf(run: TextRun): JSONContent["marks"] {
  if (run.code) return [{ type: "code" }];
  const marks: NonNullable<JSONContent["marks"]> = [];
  if (run.bold) marks.push({ type: "bold" });
  if (run.italic) marks.push({ type: "italic" });
  if (run.strike) marks.push({ type: "strike" });
  if (run.link) marks.push({ type: "link", attrs: { href: run.link } });
  return marks;
}

export function runsToInline(runs: RichText): JSONContent[] {
  const out: JSONContent[] = [];
  for (const run of runs) {
    if (run.type === "mention") {
      out.push({
        type: "mention",
        attrs: { kind: run.kind, id: run.id, label: run.label ?? null },
      });
      continue;
    }
    const marks = marksOf(run);
    run.text.split("\n").forEach((piece, index) => {
      if (index > 0) out.push({ type: "hardBreak" });
      if (piece) {
        out.push({
          type: "text",
          text: piece,
          ...(marks?.length ? { marks } : {}),
        });
      }
    });
  }
  return out;
}

function runMarks(node: JSONContent): Omit<TextRun, "type" | "text"> {
  const out: Omit<TextRun, "type" | "text"> = {};
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") out.bold = true;
    if (mark.type === "italic") out.italic = true;
    if (mark.type === "strike") out.strike = true;
    if (mark.type === "code") out.code = true;
    if (mark.type === "link" && typeof mark.attrs?.href === "string") {
      out.link = mark.attrs.href;
    }
  }
  return out.code ? { code: true } : out;
}

/** A hard break takes the marks of the text before it, so marked text across a line stays one run. */
export function inlineToRuns(
  content: readonly JSONContent[] | undefined,
): RichText {
  const runs: InlineRun[] = [];
  for (const node of content ?? []) {
    if (node.type === "text" && node.text) {
      runs.push({ type: "text", text: node.text, ...runMarks(node) });
    } else if (node.type === "hardBreak") {
      const last = runs.at(-1);
      runs.push(
        last?.type === "text"
          ? { ...last, text: "\n" }
          : { type: "text", text: "\n" },
      );
    } else if (node.type === "mention") {
      const kind = mentionKindSchema.safeParse(node.attrs?.kind);
      const id = node.attrs?.id;
      const label = node.attrs?.label;
      if (kind.success && typeof id === "string" && id) {
        runs.push({
          type: "mention",
          kind: kind.data,
          id,
          ...(typeof label === "string" && label ? { label } : {}),
        });
      }
    }
  }
  return normalizeRuns(runs);
}

function paragraph(text: RichText, id: string | null = null): JSONContent {
  const content = runsToInline(text);
  return {
    type: "paragraph",
    attrs: { id },
    ...(content.length > 0 ? { content } : {}),
  };
}

/** A container that must hold a block holds an empty paragraph when it has none. */
function atLeastOne(nodes: JSONContent[]): JSONContent[] {
  return nodes.length > 0 ? nodes : [paragraph([])];
}

function fieldsOf(block: Block): Record<string, unknown> {
  const { id: _id, type: _type, ...rest } = block;
  return rest;
}

function blockNode(block: Block): JSONContent {
  switch (block.type) {
    case "paragraph":
      return paragraph(block.text, block.id);
    case "heading": {
      const content = runsToInline(block.text);
      return {
        type: "heading",
        attrs: { id: block.id, level: block.level },
        ...(content.length > 0 ? { content } : {}),
      };
    }
    case "bullet":
    case "numbered":
      return {
        type: "listItem",
        attrs: { id: block.id },
        content: [paragraph(block.text), ...blocksToNodes(block.children)],
      };
    case "todo":
      return {
        type: "taskItem",
        attrs: { id: block.id, checked: block.checked },
        content: [paragraph(block.text), ...blocksToNodes(block.children)],
      };
    case "toggle":
      return {
        type: "toggle",
        attrs: { id: block.id, level: block.level ?? null },
        content: [paragraph(block.text), ...blocksToNodes(block.children)],
      };
    case "callout":
      return {
        type: "callout",
        attrs: { id: block.id, emoji: block.emoji, color: block.color },
        content: [paragraph(block.text), ...blocksToNodes(block.children)],
      };
    case "quote":
      return {
        type: "blockquote",
        attrs: { id: block.id },
        content: [paragraph(block.text), ...blocksToNodes(block.children)],
      };
    case "code":
      return {
        type: "codeBlock",
        attrs: { id: block.id, language: block.language || null },
        ...(block.code
          ? { content: [{ type: "text", text: block.code }] }
          : {}),
      };
    case "divider":
      return { type: "horizontalRule", attrs: { id: block.id } };
    case "columns":
      return {
        type: "columns",
        attrs: { id: block.id },
        content: block.children.map((column) => ({
          type: "column",
          attrs: { id: column.id, width: column.width },
          content: atLeastOne(blocksToNodes(column.children)),
        })),
      };
    case "column":
      return {
        type: "column",
        attrs: { id: block.id, width: block.width },
        content: atLeastOne(blocksToNodes(block.children)),
      };
    default:
      return {
        type: "atomBlock",
        attrs: { id: block.id, blockType: block.type, data: fieldsOf(block) },
      };
  }
}

export function blocksToNodes(blocks: readonly Block[]): JSONContent[] {
  const nodes: JSONContent[] = [];
  for (const block of blocks) {
    const wrapper = LIST_WRAPPER[block.type];
    if (!wrapper) {
      nodes.push(blockNode(block));
      continue;
    }
    const last = nodes.at(-1);
    if (last?.type === wrapper && last.content) {
      last.content.push(blockNode(block));
    } else {
      nodes.push({ type: wrapper, content: [blockNode(block)] });
    }
  }
  return nodes;
}

export function blocksToDoc(blocks: readonly Block[]): JSONContent {
  return { type: "doc", content: atLeastOne(blocksToNodes(blocks)) };
}

function idOf(node: JSONContent): string {
  const id = node.attrs?.id;
  return typeof id === "string" && id ? id : newId();
}

/** A container's text slot and the children after it. */
function textSlot(node: JSONContent): { text: RichText; rest: JSONContent[] } {
  const [first, ...rest] = node.content ?? [];
  if (first?.type === "paragraph") {
    return { text: inlineToRuns(first.content), rest };
  }
  return { text: [], rest: node.content ?? [] };
}

function headingLevel(value: unknown): HeadingLevel {
  return value === 1 || value === 3 ? value : 2;
}

/** A lone empty paragraph is ProseMirror's filler for a container that must hold a block. */
function withoutFiller(blocks: Block[]): Block[] {
  const [only] = blocks;
  return blocks.length === 1 &&
    only?.type === "paragraph" &&
    only.text.length === 0
    ? []
    : blocks;
}

function nodeToBlocks(node: JSONContent): Block[] {
  switch (node.type) {
    case "paragraph":
      return [
        { id: idOf(node), type: "paragraph", text: inlineToRuns(node.content) },
      ];
    case "heading":
      return [
        {
          id: idOf(node),
          type: "heading",
          level: headingLevel(node.attrs?.level),
          text: inlineToRuns(node.content),
        },
      ];
    case "bulletList":
    case "orderedList":
      return (node.content ?? []).map((item) => {
        const { text, rest } = textSlot(item);
        return {
          id: idOf(item),
          type: node.type === "bulletList" ? "bullet" : "numbered",
          text,
          children: nodesToBlocks(rest),
        };
      });
    case "taskList":
      return (node.content ?? []).map((item) => {
        const { text, rest } = textSlot(item);
        return {
          id: idOf(item),
          type: "todo",
          text,
          checked: item.attrs?.checked === true,
          children: nodesToBlocks(rest),
        };
      });
    case "toggle": {
      const { text, rest } = textSlot(node);
      const level = node.attrs?.level;
      return [
        {
          id: idOf(node),
          type: "toggle",
          text,
          ...(level === 1 || level === 2 || level === 3 ? { level } : {}),
          children: nodesToBlocks(rest),
        },
      ];
    }
    case "callout": {
      const { text, rest } = textSlot(node);
      const parsed = blockSchema.safeParse({
        id: idOf(node),
        type: "callout",
        text,
        emoji: node.attrs?.emoji,
        color: node.attrs?.color,
        children: nodesToBlocks(rest),
      });
      return parsed.success ? [parsed.data] : [];
    }
    case "blockquote": {
      const { text, rest } = textSlot(node);
      return [
        { id: idOf(node), type: "quote", text, children: nodesToBlocks(rest) },
      ];
    }
    case "codeBlock": {
      const language = node.attrs?.language;
      return [
        {
          id: idOf(node),
          type: "code",
          code: (node.content ?? []).map((child) => child.text ?? "").join(""),
          language: typeof language === "string" ? language : "",
        },
      ];
    }
    case "horizontalRule":
      return [{ id: idOf(node), type: "divider" }];
    case "columns":
      return [
        {
          id: idOf(node),
          type: "columns",
          children: (node.content ?? []).flatMap((column) => {
            const width = column.attrs?.width;
            return column.type === "column"
              ? [
                  {
                    id: idOf(column),
                    type: "column" as const,
                    width:
                      typeof width === "number" && width > 0 && width <= 1
                        ? width
                        : 0.5,
                    children: withoutFiller(
                      nodesToBlocks(column.content ?? []),
                    ),
                  },
                ]
              : [];
          }),
        },
      ];
    case "atomBlock": {
      const data = node.attrs?.data;
      const parsed = blockSchema.safeParse({
        ...(typeof data === "object" && data !== null ? data : {}),
        id: idOf(node),
        type: node.attrs?.blockType,
      });
      return parsed.success ? [parsed.data] : [];
    }
    default:
      return [];
  }
}

export function nodesToBlocks(nodes: readonly JSONContent[]): Block[] {
  return nodes.flatMap(nodeToBlocks);
}

export function docToBlocks(doc: JSONContent): Block[] {
  return withoutFiller(nodesToBlocks(doc.content ?? []));
}

/** `blocks` as the editor would hand them back: what the editor's diff is taken against. */
export function canonicalBlocks(blocks: readonly Block[]): Block[] {
  return docToBlocks(blocksToDoc(blocks));
}

// --- turn into ----------------------------------------------------------------

export type TurnIntoTarget = {
  key: string;
  label: string;
  type: BlockOf<
    | "paragraph"
    | "heading"
    | "bullet"
    | "numbered"
    | "todo"
    | "toggle"
    | "callout"
    | "quote"
    | "code"
  >["type"];
  level?: HeadingLevel;
};

export const TURN_INTO: TurnIntoTarget[] = [
  { key: "paragraph", label: "Text", type: "paragraph" },
  { key: "h1", label: "Heading 1", type: "heading", level: 1 },
  { key: "h2", label: "Heading 2", type: "heading", level: 2 },
  { key: "h3", label: "Heading 3", type: "heading", level: 3 },
  { key: "bullet", label: "Bulleted list", type: "bullet" },
  { key: "numbered", label: "Numbered list", type: "numbered" },
  { key: "todo", label: "To-do", type: "todo" },
  { key: "toggle", label: "Toggle", type: "toggle" },
  { key: "toggle-h1", label: "Toggle heading 1", type: "toggle", level: 1 },
  { key: "toggle-h2", label: "Toggle heading 2", type: "toggle", level: 2 },
  { key: "toggle-h3", label: "Toggle heading 3", type: "toggle", level: 3 },
  { key: "callout", label: "Callout", type: "callout" },
  { key: "quote", label: "Quote", type: "quote" },
  { key: "code", label: "Code", type: "code" },
];

export function canTurnInto(block: Block): boolean {
  return isTextBlock(block) || block.type === "code";
}

/**
 * `block` as `target`, same id: its text carried over, its children kept
 * when the target holds children and otherwise following it as siblings.
 */
export function turnInto(block: Block, target: TurnIntoTarget): Block[] {
  if (!canTurnInto(block)) return [block];
  const text: RichText = isTextBlock(block)
    ? block.text
    : block.type === "code"
      ? textRuns(block.code)
      : [];
  const children = isContainer(block) ? [...block.children] : [];
  const id = block.id;
  switch (target.type) {
    case "paragraph":
      return [{ id, type: "paragraph", text }, ...children];
    case "heading":
      return [
        { id, type: "heading", level: target.level ?? 2, text },
        ...children,
      ];
    case "code":
      return [
        { id, type: "code", code: plainText(text), language: "" },
        ...children,
      ];
    case "bullet":
    case "numbered":
    case "quote":
      return [{ id, type: target.type, text, children }];
    case "todo":
      return [
        {
          id,
          type: "todo",
          text,
          checked: block.type === "todo" ? block.checked : false,
          children,
        },
      ];
    case "toggle":
      return [
        {
          id,
          type: "toggle",
          text,
          ...(target.level ? { level: target.level } : {}),
          children,
        },
      ];
    case "callout":
      return [
        {
          id,
          type: "callout",
          text,
          emoji: block.type === "callout" ? block.emoji : "💡",
          color: block.type === "callout" ? block.color : "default",
          children,
        },
      ];
  }
}
