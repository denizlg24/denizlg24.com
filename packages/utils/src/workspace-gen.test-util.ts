import type { Block, BlockSpan, BlockType, WorkspacePage } from "@repo/schemas";

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
  "- [x] done-like",
  "<!-- block -->",
  '<!-- block id="x" -->',
  "\\<!-- block",
  ':::block{type="agenda"}',
  ":::",
  "---",
  "-->",
  '"quoted"',
  "back\\slash",
  "{json}",
  "[array]",
  "emoji 🧭",
  "tab\tchar",
  "\r",
  "trailing ",
  "  leading",
];

const SPANS: BlockSpan[] = [2, 3, 4, 6];

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

const TYPES: BlockType[] = [
  "heading",
  "text",
  "divider",
  "todo",
  "links",
  "subpages",
  "greeting",
  "stats",
  "agenda",
  "tasks",
  "semester",
  "alerts",
  "budget",
  "resources",
  "llm",
  "notes",
  "contacts",
  "now",
  "board",
  "agent",
  "modules",
];

export function genBlock(r: Rng): Block {
  const type = r.pick(TYPES);
  const base = {
    id: genId(r),
    span: r.pick(SPANS),
    ...(r.next() < 0.3 ? { title: genText(r, r.next() < 0.3) } : {}),
  };
  switch (type) {
    case "heading":
      return { ...base, type, text: genText(r, r.next() < 0.2) };
    case "text":
      return { ...base, type, markdown: genText(r, true) };
    case "todo":
      return {
        ...base,
        type,
        items: Array.from({ length: r.int(4) }, () => ({
          id: genId(r),
          text: genText(r, r.next() < 0.2),
          done: r.next() < 0.5,
        })),
      };
    case "links":
      return {
        ...base,
        type,
        refs: Array.from({ length: r.int(3) }, () =>
          r.next() < 0.5 ? `page:${genId(r)}` : `module:${genId(r)}`,
        ),
      };
    case "modules":
      return {
        ...base,
        type,
        sections: Array.from({ length: r.int(3) }, () => genText(r, false)),
      };
    default:
      return { ...base, type };
  }
}

export function genBlocks(r: Rng, max = 8): Block[] {
  return Array.from({ length: r.int(max + 1) }, () => genBlock(r));
}

export function genPage(r: Rng, blocks = genBlocks(r)): WorkspacePage {
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
