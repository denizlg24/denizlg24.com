import type { PageRange } from "@repo/schemas";
import {
  type SplitLimits,
  sentenceCuts,
  splitRanges,
  withUrlAtoms,
} from "./text-split";
import type {
  Atom,
  Block,
  CodeBlock,
  ListBlock,
  ListItem,
  TableBlock,
} from "./types";

/** Pieces of one cut block; `seq` order lets the packer drop a repeated overlap. */
export interface Flow {
  id: number;
  seq: number;
  /** The piece without its overlap prefix. */
  plain: string;
  join: string;
}

export interface Item {
  text: string;
  start?: number;
  end?: number;
  page?: PageRange;
  flow?: Flow;
}

export interface SplitEnv extends SplitLimits {
  overlapCap: number;
  nextFlow: () => number;
}

function offset(base: number | undefined, delta: number): number | undefined {
  return base === undefined ? undefined : base + delta;
}

function whole(block: Block): Item {
  return {
    text: block.text,
    start: block.start,
    end: block.end,
    page: block.page,
  };
}

function textItems(
  text: string,
  atoms: Atom[],
  base: number | undefined,
  page: PageRange | undefined,
  env: SplitEnv,
  join: string,
): Item[] {
  const allAtoms = withUrlAtoms(text, atoms);
  const ranges = splitRanges(text, allAtoms, env);
  if (ranges.length <= 1) {
    return [
      {
        text: text.trim(),
        start: base,
        end: offset(base, text.length),
        page,
      },
    ];
  }
  const sentences = sentenceCuts(text, allAtoms);
  const flow = env.nextFlow();
  return ranges.map((range, index): Item => {
    let from = range.start;
    const previous = ranges[index - 1];
    if (previous) {
      let cut: number | undefined;
      for (const position of sentences) {
        if (position > previous.start && position < previous.end)
          cut = position;
      }
      if (cut !== undefined) {
        const overlap = text.slice(cut, previous.end).trim();
        const joined = text.slice(cut, range.end);
        if (
          env.count(overlap) <= env.overlapCap &&
          env.count(joined) <= env.hard
        ) {
          from = cut;
        }
      }
    }
    return {
      text: text.slice(from, range.end),
      start: offset(base, from),
      end: offset(base, range.end),
      page,
      flow: {
        id: flow,
        seq: index,
        plain: text.slice(range.start, range.end),
        join,
      },
    };
  });
}

function listItems(block: ListBlock, env: SplitEnv): Item[] {
  const flow = env.nextFlow();
  const out: Item[] = [];
  let seq = 0;
  let group: ListItem[] = [];
  let previousGroup: ListItem[] = [];

  const flushGroup = () => {
    if (group.length === 0) return;
    const plain = group.map((item) => item.text).join("\n");
    const first = group[0];
    let text = plain;
    let start = first?.start;
    const last = previousGroup[previousGroup.length - 1];
    if (
      last &&
      previousGroup.length > 1 &&
      env.count(last.text) <= env.overlapCap &&
      env.count(`${last.text}\n${plain}`) <= env.hard
    ) {
      text = `${last.text}\n${plain}`;
      start = last.start;
    }
    const tail = group[group.length - 1];
    out.push({
      text,
      start,
      end:
        tail?.start === undefined ? undefined : tail.start + tail.text.length,
      page: block.page,
      flow: { id: flow, seq: seq++, plain, join: "\n" },
    });
    previousGroup = group;
    group = [];
  };

  for (const item of block.items) {
    if (env.count(item.text) > env.hard) {
      flushGroup();
      previousGroup = [];
      out.push(
        ...textItems(item.text, item.atoms, item.start, block.page, env, "\n"),
      );
      seq++;
      continue;
    }
    const candidate = [...group, item].map((entry) => entry.text).join("\n");
    if (group.length > 0 && env.count(candidate) > env.fill) flushGroup();
    group.push(item);
  }
  flushGroup();
  return out;
}

function tableItems(block: TableBlock, env: SplitEnv): Item[] {
  const out: Item[] = [];
  let rows: TableBlock["rows"] = [];
  const render = (entries: TableBlock["rows"]) =>
    `${block.head}\n${entries.map((row) => row.text).join("\n")}`;
  const flush = () => {
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (!first || !last) return;
    out.push({
      text: render(rows),
      start: out.length === 0 ? block.start : first.start,
      end: last.start === undefined ? undefined : last.start + last.text.length,
      page: block.page,
    });
    rows = [];
  };
  for (const row of block.rows) {
    if (rows.length > 0 && env.count(render([...rows, row])) > env.fill) {
      flush();
    }
    rows.push(row);
  }
  flush();
  return out;
}

function codeItems(block: CodeBlock, env: SplitEnv): Item[] {
  const wrap = (code: string) =>
    `${block.fence}${block.lang}\n${code}\n${block.fence}`;
  const units: { text: string; sep: string }[] = [];
  for (const group of block.code.split(/\n[ \t]*\n+/)) {
    if (env.count(wrap(group)) <= env.hard) {
      units.push({ text: group, sep: "\n\n" });
      continue;
    }
    for (const line of group.split("\n")) units.push({ text: line, sep: "\n" });
  }

  const out: Item[] = [];
  let current = "";
  const flush = () => {
    if (current === "") return;
    out.push({
      text: wrap(current),
      start: block.start,
      end: block.end,
      page: block.page,
    });
    current = "";
  };
  for (const unit of units) {
    if (current === "") {
      current = unit.text;
      continue;
    }
    const candidate = current + unit.sep + unit.text;
    if (env.count(wrap(candidate)) > env.fill) {
      flush();
      current = unit.text;
    } else current = candidate;
  }
  flush();
  return out;
}

function joinItems(a: Item, b: Item): Item {
  const starts = [a.start, b.start].filter((v): v is number => v !== undefined);
  const ends = [a.end, b.end].filter((v): v is number => v !== undefined);
  return {
    text: `${a.text}\n\n${b.text}`,
    start: starts.length > 0 ? Math.min(...starts) : undefined,
    end: ends.length > 0 ? Math.max(...ends) : undefined,
    page:
      a.page && b.page
        ? {
            start: Math.min(a.page.start, b.page.start),
            end: Math.max(a.page.end, b.page.end),
          }
        : (a.page ?? b.page),
  };
}

/**
 * A glued group that is too big for one piece still keeps each introduction
 * attached to the start of what it introduces, unless the introduction is
 * itself a long piece that would only drag the next block over the budget.
 */
function groupItems(children: Block[], env: SplitEnv): Item[] {
  const out: Item[] = [];
  for (const child of children) {
    const items = blockItems(child, env);
    const previous = out[out.length - 1];
    const first = items[0];
    if (previous && first) {
      const combined = joinItems(previous, first);
      if (
        env.count(combined.text) <= env.hard ||
        env.count(previous.text) <= env.overlapCap
      ) {
        out[out.length - 1] = combined;
        out.push(...items.slice(1));
        continue;
      }
    }
    out.push(...items);
  }
  return out;
}

/**
 * A block that fits whole stays whole and keeps its source text. Otherwise it
 * is cut by its own grammar. Tables, code and atomic blocks (display math,
 * html) whose smallest unit exceeds the budget come back oversized: cutting
 * inside a row, a line or an equation would lose its meaning.
 */
export function blockItems(block: Block, env: SplitEnv): Item[] {
  if (env.count(block.text) <= env.hard) return [whole(block)];
  switch (block.kind) {
    case "text":
      return textItems(
        block.text,
        block.atoms,
        block.start,
        block.page,
        env,
        " ",
      );
    case "list":
      return listItems(block, env);
    case "table":
      return tableItems(block, env);
    case "code":
      return codeItems(block, env);
    case "group":
      return groupItems(block.children, env);
    case "atom":
      return [whole(block)];
  }
}
