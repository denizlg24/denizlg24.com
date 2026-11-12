import type { PageRange } from "@repo/schemas";
import type { ChunkBudget, TokenCounter } from "../knowledge-chunk";

export interface Heading {
  title: string;
  level: number;
  page?: PageRange;
  start?: number;
  end?: number;
}

/** A span (relative to its block's text) that no cut may fall inside. */
export interface Atom {
  start: number;
  end: number;
}

interface BlockBase {
  text: string;
  start?: number;
  end?: number;
  page?: PageRange;
}

export interface TextBlock extends BlockBase {
  kind: "text";
  atoms: Atom[];
}

export interface ListItem {
  text: string;
  start?: number;
  atoms: Atom[];
}

export interface ListBlock extends BlockBase {
  kind: "list";
  items: ListItem[];
}

export interface TableRow {
  text: string;
  start?: number;
}

export interface TableBlock extends BlockBase {
  kind: "table";
  /** Header row and delimiter row, repeated in every piece. */
  head: string;
  rows: TableRow[];
}

export interface CodeBlock extends BlockBase {
  kind: "code";
  lang: string;
  fence: string;
  code: string;
}

export interface AtomBlock extends BlockBase {
  kind: "atom";
}

export interface GroupBlock extends BlockBase {
  kind: "group";
  children: Block[];
}

export type Block =
  | TextBlock
  | ListBlock
  | TableBlock
  | CodeBlock
  | AtomBlock
  | GroupBlock;

export interface Section {
  heading?: Heading;
  blocks: Block[];
  children: Section[];
}

export interface ChunkContext {
  title: string;
  budget: ChunkBudget;
  count: TokenCounter;
  /** PDF chunks carry a page label in their header. */
  paged: boolean;
}

export class SectionBuilder {
  readonly root: Section = { blocks: [], children: [] };
  private readonly stack: { level: number; section: Section }[] = [
    { level: 0, section: this.root },
  ];

  open(heading: Heading): void {
    while (this.top().level >= heading.level) this.stack.pop();
    const section: Section = { heading, blocks: [], children: [] };
    this.top().section.children.push(section);
    this.stack.push({ level: heading.level, section });
  }

  add(block: Block): void {
    this.top().section.blocks.push(block);
  }

  private top(): { level: number; section: Section } {
    const top = this.stack[this.stack.length - 1];
    if (!top) throw new Error("section stack is empty");
    return top;
  }
}
