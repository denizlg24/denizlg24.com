import {
  BLOCK_SPANS,
  type Block,
  type BlockSpan,
  isWidgetType,
  type LegacyBlock,
  type LegacyPage,
  type RichText,
  type WorkspacePage,
} from "@repo/schemas";
import { blocksToMarkdown, markdownToBlocks } from "./workspace-markdown";
import { textRuns } from "./workspace-rich-text";
import { walkBlocks } from "./workspace-tree";

/*
 * The v1 grid ↔ the flow.
 *
 * Up (migration, and blocks desktop 3.0.0 writes): consecutive grid blocks
 * pack into rows of 6 by span; a row holding more than one block becomes a
 * `columns` block whose columns are as wide as their spans' share of the
 * row. A v1 heading is a level-2 heading, a text block the blocks its
 * markdown describes, a todo one todo item per entry, a title on any of
 * those a level-3 heading above it; widgets and dividers carry over.
 *
 * Down (what 3.0.0 is served): every flow block becomes exactly one v1 block
 * with the same id, so an edit 3.0.0 sends back names the block it changed.
 * Columns flatten into their blocks, each spanning its column's share; a
 * plain level-2 heading stays a heading, a plain childless todo a todo, a
 * widget or divider itself; everything else is a v1 text block holding the
 * block's own markdown, directives and markers included.
 */

const ROW = 6;

/** Ids derived from a v1 block's: deterministic, so a re-run produces the same page. */
export function derivedIds(base: string): () => string {
  let n = 0;
  return () => `${base}-${++n}`;
}

function isPlain(text: RichText): boolean {
  return text.every(
    (run) =>
      run.type === "text" &&
      !run.bold &&
      !run.italic &&
      !run.strike &&
      !run.code &&
      !run.link,
  );
}

function plain(text: RichText): string {
  return text.map((run) => (run.type === "text" ? run.text : "")).join("");
}

/**
 * The flow blocks one v1 block becomes. The first new block takes the v1
 * block's id unless markdown inside it already claims that id.
 */
export function legacyBlockToFlow(
  block: LegacyBlock,
  newId: () => string,
): Block[] {
  const titled = (blocks: Block[]): Block[] =>
    block.title && (block.type === "text" || block.type === "todo")
      ? [
          {
            id: `${block.id}-title`,
            type: "heading",
            level: 3,
            text: textRuns(block.title),
          },
          ...blocks,
        ]
      : blocks;
  switch (block.type) {
    case "heading":
      return [
        { id: block.id, type: "heading", level: 2, text: textRuns(block.text) },
      ];
    case "divider":
      return [{ id: block.id, type: "divider" }];
    case "todo":
      return titled(
        block.items.map((item, index) => ({
          id: index === 0 ? block.id : item.id,
          type: "todo",
          text: textRuns(item.text),
          checked: item.done,
          children: [],
        })),
      );
    case "text": {
      const generated = new Set<string>();
      const parsed = markdownToBlocks(block.markdown, {
        lenient: true,
        newId: () => {
          const id = `\u0000${generated.size}`;
          generated.add(id);
          return id;
        },
      });
      const claimed = new Set<string>();
      walkBlocks(parsed, (b) => {
        if (!generated.has(b.id)) claimed.add(b.id);
      });
      let first = !claimed.has(block.id);
      const rename = new Map<string, string>();
      for (const id of generated) {
        rename.set(id, first ? block.id : newId());
        first = false;
      }
      return titled(renameIds(parsed, rename));
    }
    case "links":
      return [
        {
          id: block.id,
          type: "links",
          refs: block.refs,
          ...(block.title !== undefined ? { title: block.title } : {}),
        },
      ];
    case "modules":
      return [
        {
          id: block.id,
          type: "modules",
          sections: block.sections,
          ...(block.title !== undefined ? { title: block.title } : {}),
        },
      ];
    default:
      return [
        {
          id: block.id,
          type: block.type,
          ...(block.title !== undefined ? { title: block.title } : {}),
        },
      ];
  }
}

function renameIds(blocks: Block[], rename: Map<string, string>): Block[] {
  return blocks.map((block) => {
    const id = rename.get(block.id) ?? block.id;
    if (block.type === "columns") {
      return {
        ...block,
        id,
        children: block.children.map((column) => ({
          ...column,
          id: rename.get(column.id) ?? column.id,
          children: renameIds(column.children, rename),
        })),
      };
    }
    if ("children" in block) {
      return { ...block, id, children: renameIds(block.children, rename) };
    }
    return { ...block, id };
  });
}

/** Grid rows: consecutive blocks while their spans fit in 6. */
export function packRows(blocks: readonly LegacyBlock[]): LegacyBlock[][] {
  const rows: LegacyBlock[][] = [];
  let row: LegacyBlock[] = [];
  let used = 0;
  for (const block of blocks) {
    if (row.length > 0 && used + block.span > ROW) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(block);
    used += block.span;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** A v1 page's grid as a flow; deterministic for the same input. */
export function upgradeLegacyBlocks(blocks: readonly LegacyBlock[]): Block[] {
  const out: Block[] = [];
  for (const row of packRows(blocks)) {
    const [only] = row;
    if (row.length === 1 && only) {
      out.push(...legacyBlockToFlow(only, derivedIds(only.id)));
      continue;
    }
    const total = row.reduce((sum, block) => sum + block.span, 0);
    out.push({
      id: `${row[0]?.id ?? "row"}-row`,
      type: "columns",
      children: row.map((block) => ({
        id: `${block.id}-col`,
        type: "column",
        width: block.span / total,
        children: legacyBlockToFlow(block, derivedIds(block.id)),
      })),
    });
  }
  return out;
}

export function upgradeLegacyPage(page: LegacyPage): WorkspacePage {
  return { ...page, blocks: upgradeLegacyBlocks(page.blocks) };
}

function nearestSpan(share: number): BlockSpan {
  const target = share * ROW;
  let best: BlockSpan = 6;
  for (const span of BLOCK_SPANS) {
    if (Math.abs(span - target) < Math.abs(best - target)) best = span;
  }
  return best;
}

function downgradeOne(block: Block, span: BlockSpan): LegacyBlock {
  if (isWidgetType(block.type)) return downgradeWidget(block, span);
  if (block.type === "divider") return { id: block.id, span, type: "divider" };
  if (block.type === "heading" && block.level === 2 && isPlain(block.text)) {
    const text = plain(block.text);
    if (!text.includes("\n")) {
      return { id: block.id, span, type: "heading", text };
    }
  }
  if (
    block.type === "todo" &&
    block.children.length === 0 &&
    isPlain(block.text) &&
    !plain(block.text).includes("\n")
  ) {
    return {
      id: block.id,
      span,
      type: "todo",
      items: [{ id: block.id, text: plain(block.text), done: block.checked }],
    };
  }
  return {
    id: block.id,
    span,
    type: "text",
    markdown: blocksToMarkdown([block]),
  };
}

function downgradeWidget(block: Block, span: BlockSpan): LegacyBlock {
  const title =
    "title" in block && block.title !== undefined ? { title: block.title } : {};
  switch (block.type) {
    case "links":
      return { id: block.id, span, type: "links", refs: block.refs, ...title };
    case "modules":
      return {
        id: block.id,
        span,
        type: "modules",
        sections: block.sections,
        ...title,
      };
    case "subpages":
    case "greeting":
    case "stats":
    case "agenda":
    case "tasks":
    case "semester":
    case "alerts":
    case "budget":
    case "resources":
    case "llm":
    case "notes":
    case "contacts":
    case "now":
    case "board":
    case "agent":
      return { id: block.id, span, type: block.type, ...title };
    default:
      return {
        id: block.id,
        span,
        type: "text",
        markdown: blocksToMarkdown([block]),
      };
  }
}

/** The v1 grid 3.0.0 is served for a flow; one v1 block per flow block, ids kept. */
export function downgradeBlocks(blocks: readonly Block[]): LegacyBlock[] {
  const out: LegacyBlock[] = [];
  for (const block of blocks) {
    if (block.type !== "columns") {
      out.push(downgradeOne(block, 6));
      continue;
    }
    const total =
      block.children.reduce((sum, column) => sum + column.width, 0) || 1;
    for (const column of block.children) {
      const span = nearestSpan(column.width / total);
      for (const child of column.children) out.push(downgradeOne(child, span));
    }
  }
  return out;
}

export function downgradePage(page: WorkspacePage): LegacyPage {
  return { ...page, blocks: downgradeBlocks(page.blocks) };
}
