import type {
  Block,
  BlockOf,
  BlockType,
  InlineRun,
  LegacyBlock,
  LegacyBlockType,
  RichText,
  WorkflowAction,
  WorkspacePage,
} from "@repo/schemas";
import {
  CALLOUT_COLORS,
  ENTITY_KINDS,
  MENTION_KINDS,
  VIEW_FILTER_OPS,
  VIEW_LAYOUTS,
  VIEW_SOURCE_IDS,
  WIDGET_TYPES,
} from "@repo/schemas";
import { normalizeRuns } from "./workspace-rich-text";
import { canContain, isContainerType } from "./workspace-tree";

/** Mulberry32: a seeded generator, so a failing case can be replayed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(next() * max);
  const pick = <T>(list: readonly T[]): T => {
    const value = list[int(list.length)];
    if (value === undefined) throw new Error("pick from an empty list");
    return value;
  };
  return { next, int, pick };
}

export type Rng = ReturnType<typeof rng>;

const FRAGMENTS = [
  "",
  " ",
  "plain",
  "## heading-like",
  "- [ ] todo-like",
  "1. numbered-like",
  "> quote-like",
  "<!-- block -->",
  '<!-- id="x" -->',
  "<details>",
  "</summary>",
  "\\<!-- block",
  ':::block{type="agenda"}',
  ":::",
  "$$",
  "```",
  "---",
  "-->",
  "*",
  "**",
  "_",
  "~~",
  "`",
  "[",
  "](x)",
  "@",
  "![",
  "&#32;",
  "&amp;",
  "<br>",
  '"quoted"',
  "back\\slash",
  "{json}",
  "emoji 🧭",
  "tab\tchar",
  "\r",
  "trailing ",
  "  leading",
];

export function genText(r: Rng, multiline: boolean): string {
  const parts: string[] = [];
  const count = r.int(5);
  for (let i = 0; i < count; i++) {
    parts.push(r.pick(FRAGMENTS));
    if (multiline && r.next() < 0.4)
      parts.push(r.pick(["\n", "\n\n", "\n\n\n"]));
  }
  return parts.join(r.next() < 0.5 ? "" : " ");
}

let counter = 0;
export function genId(r: Rng): string {
  counter += 1;
  return `b${counter.toString(36)}${r.int(1000).toString(36)}`;
}

const HREFS = [
  "https://example.com",
  "https://example.com/a_(b)",
  "with space",
  "page:x",
  "<odd>",
];

export function genRichText(r: Rng): RichText {
  const runs: InlineRun[] = [];
  const count = r.int(5);
  for (let i = 0; i < count; i++) {
    if (r.next() < 0.15) {
      const kind = r.pick(MENTION_KINDS);
      runs.push({
        type: "mention",
        kind,
        id: kind === "date" ? "2026-10-29" : r.pick(["p1", "a b", "x)y"]),
        ...(r.next() < 0.6 ? { label: genText(r, false) || "Name" } : {}),
      });
      continue;
    }
    const text = genText(r, r.next() < 0.2);
    if (!text) continue;
    runs.push({
      type: "text",
      text,
      ...(r.next() < 0.3 ? { bold: true as const } : {}),
      ...(r.next() < 0.3 ? { italic: true as const } : {}),
      ...(r.next() < 0.2 ? { strike: true as const } : {}),
      ...(r.next() < 0.2 ? { code: true as const } : {}),
      ...(r.next() < 0.2 ? { link: r.pick(HREFS) } : {}),
    });
  }
  return normalizeRuns(runs);
}

const LEAF_TYPES: BlockType[] = [
  "paragraph",
  "heading",
  "code",
  "divider",
  "image",
  "file",
  "bookmark",
  "equation",
  "table",
  "toc",
  "breadcrumb",
  "synced",
  "record",
  "view",
  "button",
  ...WIDGET_TYPES,
];
const CONTAINER_CHOICES: BlockType[] = [
  "bullet",
  "numbered",
  "todo",
  "toggle",
  "callout",
  "quote",
  "columns",
];

function genChildren(r: Rng, parent: BlockType, depth: number): Block[] {
  if (parent === "columns") {
    const n = 1 + r.int(3);
    return Array.from({ length: n }, () => genColumn(r, depth + 1, 1 / n));
  }
  if (depth >= 3) return [];
  return genBlocks(r, 3, depth + 1, parent);
}

function genColumn(r: Rng, depth: number, width: number): BlockOf<"column"> {
  return {
    id: genId(r),
    type: "column",
    width,
    children: depth >= 3 ? [] : genBlocks(r, 3, depth + 1, "column"),
  };
}

export function genBlock(
  r: Rng,
  depth = 0,
  parent: BlockType | null = null,
): Block {
  if (parent === "columns") return genColumn(r, depth, 0.5);
  let type: BlockType;
  do {
    type =
      r.next() < 0.35 && depth < 3
        ? r.pick(CONTAINER_CHOICES)
        : r.pick(LEAF_TYPES);
  } while (!canContain(parent, type));
  const id = genId(r);
  const children = isContainerType(type) ? genChildren(r, type, depth) : [];
  const title = r.next() < 0.3 ? { title: genText(r, r.next() < 0.3) } : {};
  switch (type) {
    case "paragraph":
      return { id, type, text: genRichText(r) };
    case "heading":
      return {
        id,
        type,
        level: r.pick([1, 2, 3] as const),
        text: genRichText(r),
      };
    case "bullet":
    case "numbered":
    case "quote":
      return { id, type, text: genRichText(r), children };
    case "todo":
      return {
        id,
        type,
        text: genRichText(r),
        checked: r.next() < 0.5,
        children,
      };
    case "toggle":
      return {
        id,
        type,
        text: genRichText(r),
        ...(r.next() < 0.4 ? { level: r.pick([1, 2, 3] as const) } : {}),
        children,
      };
    case "callout":
      return {
        id,
        type,
        text: genRichText(r),
        emoji: r.pick(["💡", "⚠️", "🧭"]),
        color: r.pick(CALLOUT_COLORS),
        children,
      };
    case "columns":
      return {
        id,
        type,
        children: children.filter(
          (c): c is BlockOf<"column"> => c.type === "column",
        ),
      };
    case "code":
      return {
        id,
        type,
        code: genText(r, true),
        language: r.pick(["", "ts", "c++", "with space", "<x>"]),
      };
    case "divider":
    case "toc":
    case "breadcrumb":
      return { id, type };
    case "image":
      return {
        id,
        type,
        url: r.pick([
          "",
          "https://x.y/a.png",
          "with space.png",
          "a(b).png",
          "<odd>",
        ]),
        caption: genRichText(r),
      };
    case "file":
      return {
        id,
        type,
        url: "https://x.y/f.pdf",
        name: genText(r, false),
        ...(r.next() < 0.5 ? { size: r.int(100000) } : {}),
      };
    case "bookmark":
      return {
        id,
        type,
        url: "https://x.y",
        ...(r.next() < 0.5 ? { title: genText(r, false) } : {}),
        ...(r.next() < 0.5 ? { description: genText(r, true) } : {}),
      };
    case "equation":
      return { id, type, expression: genText(r, true) };
    case "table": {
      const cols = 1 + r.int(3);
      return {
        id,
        type,
        rows: Array.from({ length: r.int(3) }, () =>
          Array.from({ length: cols }, () => genRichText(r)),
        ),
        headerRow: r.next() < 0.5,
      };
    }
    case "synced":
      return { id, type, pageId: "p2", blockId: genId(r) };
    case "record":
      return {
        id,
        type,
        ref:
          r.next() < 0.2
            ? ""
            : `entity:${r.pick(ENTITY_KINDS)}:${r.pick(["a1", "6650f0c2", "x_y-z"])}`,
        mode: r.pick(["card", "full"] as const),
      };
    case "view":
      return {
        id,
        type,
        source: r.pick(VIEW_SOURCE_IDS),
        layout: r.pick(VIEW_LAYOUTS),
        filters: Array.from({ length: r.int(3) }, () => ({
          field: r.pick(["title", "due", "labels"]),
          op: r.pick(VIEW_FILTER_OPS),
          ...(r.next() < 0.8
            ? {
                value: r.pick([
                  genText(r, false),
                  3,
                  true,
                  ["a", "b c"],
                  "2026-10-29",
                ]),
              }
            : {}),
        })),
        sort:
          r.next() < 0.5
            ? [{ field: "due", dir: r.pick(["asc", "desc"] as const) }]
            : [],
        ...(r.next() < 0.4 ? { group: "column" } : {}),
        limit: 1 + r.int(200),
        ...(r.next() < 0.3 ? { fields: ["title", "due"] } : {}),
        ...(r.next() < 0.2 ? { dateField: "due" } : {}),
        ...title,
      };
    case "button":
      return {
        id,
        type,
        label: genText(r, false),
        mode: r.pick(["actions", "agent"] as const),
        actions: Array.from({ length: r.int(4) }, () => genAction(r)),
        agentPrompt: genText(r, true),
      };
    case "links":
      return {
        id,
        type,
        refs: Array.from({ length: r.int(3) }, () =>
          r.next() < 0.5 ? `page:${genId(r)}` : `module:${genId(r)}`,
        ),
        ...title,
      };
    case "modules":
      return {
        id,
        type,
        sections: Array.from({ length: r.int(3) }, () => genText(r, false)),
        ...title,
      };
    case "column":
      return genColumn(r, depth, 1);
    default:
      return { id, type, ...title };
  }
}

export function genAction(r: Rng): WorkflowAction {
  const text = () => genText(r, r.next() < 0.3) || "x";
  switch (r.int(7)) {
    case 0:
      return {
        kind: "create-page",
        templateId: "tpl",
        parentId: r.pick([null, "$this", "home"]),
        ...(r.next() < 0.5 ? { title: text() } : {}),
        inputs: r.next() < 0.5 ? { Focus: text() } : {},
      };
    case 1:
      return { kind: "append-blocks", pageId: "$this", markdown: text() };
    case 2:
      return { kind: "insert-template", templateId: "tpl", inputs: {} };
    case 3:
      return {
        kind: "create-card",
        boardId: "6650f0c2a1b2c3d4e5f60718",
        columnId: "6650f0c2a1b2c3d4e5f60719",
        title: text(),
        ...(r.next() < 0.5 ? { description: text() } : {}),
        ...(r.next() < 0.5 ? { dueDate: "{{date}}" } : {}),
      };
    case 4:
      return {
        kind: "create-event",
        title: text(),
        date: "{{date}}",
        ...(r.next() < 0.5 ? { time: "09:30" } : {}),
        durationMinutes: 30,
      };
    case 5:
      return {
        kind: "set-todo",
        pageId: "$this",
        blockId: "todo1",
        checked: r.next() < 0.5,
      };
    default:
      return { kind: "open", url: r.pick(["/dashboard", "https://x.y/?a=b"]) };
  }
}

export function genBlocks(
  r: Rng,
  max = 8,
  depth = 0,
  parent: BlockType | null = null,
): Block[] {
  return Array.from({ length: r.int(max + 1) }, () =>
    genBlock(r, depth, parent),
  );
}

export function genPage(r: Rng, blocks: Block[] = genBlocks(r)): WorkspacePage {
  return {
    id: "p1",
    title: genText(r, false),
    icon: null,
    parentId: null,
    order: 0,
    blocks,
    fullWidth: false,
    locked: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    deletedAt: null,
  };
}

const LEGACY_TYPES: LegacyBlockType[] = [
  "heading",
  "text",
  "divider",
  "todo",
  "links",
  "agenda",
  "stats",
  "modules",
];

export function genLegacyBlock(r: Rng): LegacyBlock {
  const type = r.pick(LEGACY_TYPES);
  const base = {
    id: genId(r),
    span: r.pick([2, 3, 4, 6] as const),
    ...(r.next() < 0.3 ? { title: genText(r, false) } : {}),
  };
  switch (type) {
    case "heading":
      return { ...base, type, text: genText(r, false) };
    case "text":
      return { ...base, type, markdown: genText(r, true) };
    case "todo":
      return {
        ...base,
        type,
        items: Array.from({ length: r.int(4) }, () => ({
          id: genId(r),
          text: genText(r, false),
          done: r.next() < 0.5,
        })),
      };
    case "links":
      return { ...base, type, refs: [`page:${genId(r)}`] };
    case "modules":
      return { ...base, type, sections: [] };
    default:
      return { ...base, type };
  }
}
