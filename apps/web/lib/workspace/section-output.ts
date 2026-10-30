import { type Block, blockSchema, SECTION_BLOCKS_MAX } from "@repo/schemas";
import { markdownToBlocks } from "@repo/utils/workspace-markdown";
import { deepEqual } from "@repo/utils/workspace-ops";
import { withFreshBlockIds } from "@repo/utils/workspace-templates";
import {
  canContain,
  childrenOf,
  countBlocks,
} from "@repo/utils/workspace-tree";

/*
 * The pure half of an agent section run: what its reply becomes, and whether
 * the section was edited since the last write.
 */

/** Types a run may not write: another section, a button, a synced copy of something else. */
const REFUSED = new Set<Block["type"]>(["section", "button", "synced"]);

function strip(blocks: readonly Block[]): Block[] {
  return blocks.flatMap((block): Block[] => {
    if (REFUSED.has(block.type)) return [];
    if (!("children" in block)) return [block];
    const parsed = blockSchema.safeParse({
      ...block,
      children: strip(block.children),
    });
    return parsed.success ? [parsed.data] : [];
  });
}

/** A whole reply wrapped in one fenced block is the model being polite; unwrap it. */
function unfence(text: string): string {
  const match = /^\s*```(?:markdown|md)?[^\n]*\n([\s\S]*?)\n```\s*$/.exec(text);
  return match?.[1] ?? text;
}

/**
 * The blocks a reply describes, fit to sit in a section: fresh ids, no
 * refused types, and whole top-level blocks only up to `max` in all.
 */
export function sectionBlocksFrom(
  text: string,
  newId: () => string,
  max = SECTION_BLOCKS_MAX,
): Block[] {
  // Ids a reply's markers claim are ignored: they could name blocks elsewhere.
  const parsed = withFreshBlockIds(
    strip(markdownToBlocks(unfence(text).trim(), { newId, lenient: true })),
    newId,
  ).filter((block) => canContain("section", block.type));
  const out: Block[] = [];
  let used = 0;
  for (const block of parsed) {
    const size = countBlocks([block]);
    if (used + size > max) break;
    out.push(block);
    used += size;
  }
  return out;
}

function blank(blocks: readonly Block[]): boolean {
  return blocks.every(
    (block) =>
      block.type === "paragraph" &&
      block.text.length === 0 &&
      childrenOf(block).length === 0,
  );
}

/**
 * Whether someone changed the section since the last write. With no write
 * yet, anything but empty paragraphs counts as someone's work.
 */
export function sectionEdited(
  children: readonly Block[],
  baseline: readonly Block[] | null,
): boolean {
  if (baseline === null) return !blank(children);
  return !deepEqual(children, baseline);
}
