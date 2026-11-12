import type { PageRange } from "@repo/schemas";
import type { ChunkDraft } from "../knowledge-chunk";
import { blockItems, type Item, type SplitEnv } from "./blocks";
import type {
  Block,
  ChunkContext,
  GroupBlock,
  Heading,
  Section,
} from "./types";

interface Unit {
  path: Heading[];
  body: string;
  start?: number;
  end?: number;
  page?: PageRange;
  /** Nothing but heading lines: dropped unless a sibling absorbs it. */
  bare: boolean;
}

interface Entry {
  unit: Unit;
  mergeable: boolean;
}

interface Rendered {
  parts: string[];
  start?: number;
  end?: number;
  page?: PageRange;
  content: boolean;
}

function minOf(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function maxOf(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function unionPage(a?: PageRange, b?: PageRange): PageRange | undefined {
  if (!a) return b;
  if (!b) return a;
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

function headingLine(heading: Heading): string {
  return `${"#".repeat(Math.min(6, Math.max(1, heading.level)))} ${heading.title}`;
}

function pageLabel(page: PageRange): string {
  return page.start === page.end
    ? `[p. ${page.start}]`
    : `[pp. ${page.start}–${page.end}]`;
}

function commonPrefix(a: Heading[], b: Heading[]): Heading[] {
  const out: Heading[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) break;
    out.push(a[i] as Heading);
  }
  return out;
}

function endsWithColon(block: Block): boolean {
  return block.kind === "text" && /:\s*$/.test(block.text);
}

/** A block ending in ":" introduces the next one (an equation, a list). */
function glueBlocks(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const first = blocks[i] as Block;
    const next = blocks[i + 1];
    if (!endsWithColon(first) || !next) {
      out.push(first);
      continue;
    }
    const parts: Block[] = [first];
    while (endsWithColon(parts[parts.length - 1] as Block) && blocks[i + 1]) {
      i++;
      parts.push(blocks[i] as Block);
    }
    const last = parts[parts.length - 1] as Block;
    const group: GroupBlock = {
      kind: "group",
      text: parts.map((part) => part.text).join("\n\n"),
      start: first.start,
      end: last.end,
      page: parts.reduce<PageRange | undefined>(
        (page, part) => unionPage(page, part.page),
        undefined,
      ),
      children: parts,
    };
    out.push(group);
  }
  return out;
}

function render(section: Section, acc: Rendered): void {
  for (const block of section.blocks) {
    acc.parts.push(block.text);
    acc.start = minOf(acc.start, block.start);
    acc.end = maxOf(acc.end, block.end);
    acc.page = unionPage(acc.page, block.page);
    acc.content = true;
  }
  for (const child of section.children) {
    if (child.heading) {
      acc.parts.push(headingLine(child.heading));
      acc.page = unionPage(acc.page, child.heading.page);
      acc.start = minOf(acc.start, child.heading.start);
      acc.end = maxOf(acc.end, child.heading.end);
    }
    render(child, acc);
  }
}

export function chunkTree(root: Section, ctx: ChunkContext): ChunkDraft[] {
  const { budget, count } = ctx;
  const overlapCap = Math.max(1, Math.ceil(budget.max * budget.overlap));
  let flowCounter = 0;
  const probePage: PageRange = { start: 999, end: 1000 };

  const headerText = (path: Heading[], page?: PageRange): string => {
    const lines = [ctx.title.trim(), path.map((h) => h.title).join(" › ")];
    if (page) lines.push(pageLabel(page));
    const kept = lines.filter((line) => line.length > 0);
    return kept.length > 0 ? `${kept.join("\n")}\n\n` : "";
  };

  const envFor = (path: Heading[]): SplitEnv => {
    const header = count(headerText(path, ctx.paged ? probePage : undefined));
    const hard = Math.max(Math.ceil(budget.max / 4), budget.max - header);
    const fill = Math.min(
      hard,
      Math.max(Math.ceil(budget.target / 4), budget.target - header),
    );
    return { fill, hard, count, overlapCap, nextFlow: () => flowCounter++ };
  };

  const totalTokens = (unit: Unit): number =>
    count(headerText(unit.path, unit.page) + unit.body);

  const bodyOf = (items: Item[]): string => {
    let out = "";
    items.forEach((item, index) => {
      const previous = items[index - 1];
      const chained =
        item.flow &&
        previous?.flow &&
        previous.flow.id === item.flow.id &&
        previous.flow.seq === item.flow.seq - 1;
      if (index === 0) out = item.text;
      else if (chained && item.flow) out += item.flow.join + item.flow.plain;
      else out += `\n\n${item.text}`;
    });
    return out;
  };

  const pack = (blocks: Block[], path: Heading[]): Unit[] => {
    const env = envFor(path);
    const items = glueBlocks(blocks).flatMap((block) => blockItems(block, env));
    const units: Unit[] = [];
    let current: Item[] = [];
    const flush = () => {
      if (current.length === 0) return;
      const unit: Unit = { path, body: bodyOf(current), bare: false };
      for (const item of current) {
        unit.start = minOf(unit.start, item.start);
        unit.end = maxOf(unit.end, item.end);
        unit.page = unionPage(unit.page, item.page);
      }
      units.push(unit);
      current = [];
    };
    for (const item of items) {
      if (current.length > 0 && count(bodyOf([...current, item])) > env.fill) {
        flush();
      }
      current.push(item);
    }
    flush();
    return units;
  };

  const tryMerge = (a: Unit, b: Unit): Unit | null => {
    const path = commonPrefix(a.path, b.path);
    let page: PageRange | undefined;
    let start = minOf(a.start, b.start);
    let end = maxOf(a.end, b.end);
    const part = (unit: Unit): string => {
      const lines = unit.path.slice(path.length).map((heading) => {
        page = unionPage(page, heading.page);
        start = minOf(start, heading.start);
        end = maxOf(end, heading.end);
        return headingLine(heading);
      });
      return [...lines, unit.body]
        .filter((text) => text.length > 0)
        .join("\n\n");
    };
    const body = [part(a), part(b)]
      .filter((text) => text.length > 0)
      .join("\n\n");
    const merged: Unit = {
      path,
      body,
      start,
      end,
      page: unionPage(unionPage(a.page, b.page), page),
      bare: a.bare && b.bare,
    };
    return totalTokens(merged) <= budget.max ? merged : null;
  };

  const isRunt = (unit: Unit): boolean =>
    unit.bare || totalTokens(unit) < budget.min;

  const mergeEntries = (entries: Entry[]): Unit[] => {
    const list = entries.slice();
    let i = 0;
    while (i < list.length) {
      const entry = list[i] as Entry;
      if (!entry.mergeable || !isRunt(entry.unit)) {
        i++;
        continue;
      }
      const next = list[i + 1];
      if (next?.mergeable) {
        const merged = tryMerge(entry.unit, next.unit);
        if (merged) {
          list.splice(i, 2, { unit: merged, mergeable: true });
          continue;
        }
      }
      const previous = list[i - 1];
      if (previous?.mergeable) {
        const merged = tryMerge(previous.unit, entry.unit);
        if (merged) {
          list.splice(i - 1, 2, { unit: merged, mergeable: true });
          i--;
          continue;
        }
      }
      i++;
    }
    return list.map((entry) => entry.unit);
  };

  const processSection = (section: Section, parent: Heading[]): Unit[] => {
    const only = section.children[0];
    if (section.blocks.length === 0 && section.children.length === 1 && only) {
      return processSection(
        only,
        section.heading ? [...parent, section.heading] : parent,
      );
    }
    const path = section.heading ? [...parent, section.heading] : parent;
    const rendered: Rendered = { parts: [], content: false };
    render(section, rendered);
    if (rendered.parts.length === 0) {
      return section.heading
        ? [{ path, body: "", page: section.heading.page, bare: true }]
        : [];
    }
    const body = rendered.parts.join("\n\n");
    if (rendered.content && count(body) <= envFor(path).fill) {
      return [
        {
          path,
          body,
          start: rendered.start,
          end: rendered.end,
          page: rendered.page,
          bare: false,
        },
      ];
    }
    if (!rendered.content) {
      return [{ path, body, page: rendered.page, bare: true }];
    }

    const entries: Entry[] = pack(section.blocks, path).map((unit) => ({
      unit,
      mergeable: true,
    }));
    for (const child of section.children) {
      const units = processSection(child, path);
      for (const unit of units) entries.push({ unit, mergeable: true });
    }
    return mergeEntries(entries);
  };

  return processSection(root, [])
    .filter((unit) => !unit.bare && unit.body.trim().length > 0)
    .map((unit, ordinal): ChunkDraft => {
      const text = headerText(unit.path, unit.page) + unit.body;
      const draft: ChunkDraft = {
        ordinal,
        headingPath: unit.path.map((heading) => heading.title),
        body: unit.body,
        text,
        tokenCount: count(text),
      };
      if (unit.start !== undefined) draft.sourceStart = unit.start;
      if (unit.end !== undefined) draft.sourceEnd = unit.end;
      if (unit.page) draft.page = unit.page;
      return draft;
    });
}
