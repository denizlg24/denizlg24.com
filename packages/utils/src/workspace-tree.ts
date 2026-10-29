import {
  type Block,
  type BlockOf,
  type BlockType,
  CONTAINER_TYPES,
  type ContainerBlock,
  isContainer,
} from "@repo/schemas";

/** Where a block sits: its parent (null is the page) and its index among siblings. */
export interface BlockLocation {
  block: Block;
  parentId: string | null;
  index: number;
  siblings: readonly Block[];
}

export function isContainerType(type: BlockType): boolean {
  return (CONTAINER_TYPES as readonly BlockType[]).includes(type);
}

export function childrenOf(block: Block): readonly Block[] {
  return isContainer(block) ? block.children : [];
}

/** A container with its children replaced; a `columns` block keeps only columns. */
export function withChildren(
  block: ContainerBlock,
  children: readonly Block[],
): ContainerBlock {
  if (block.type === "columns") {
    return {
      ...block,
      children: children.filter(
        (child): child is BlockOf<"column"> => child.type === "column",
      ),
    };
  }
  return { ...block, children: [...children] };
}

/**
 * Whether `child` may sit directly under `parent` (null is the page). A
 * column lives only in a columns block, which holds nothing else, and
 * columns do not nest inside a column.
 */
export function canContain(
  parent: BlockType | null,
  child: BlockType,
): boolean {
  if (child === "column") return parent === "columns";
  if (parent === null) return true;
  if (parent === "columns") return false;
  if (parent === "column" && child === "columns") return false;
  return isContainerType(parent);
}

/** Every block, parents before children, with its parent id and depth. */
export function walkBlocks(
  blocks: readonly Block[],
  visit: (block: Block, parentId: string | null, depth: number) => void,
  parentId: string | null = null,
  depth = 0,
): void {
  for (const block of blocks) {
    visit(block, parentId, depth);
    walkBlocks(childrenOf(block), visit, block.id, depth + 1);
  }
}

/** Ids of every block in the tree, parents first. */
export function treeIds(blocks: readonly Block[]): string[] {
  const ids: string[] = [];
  walkBlocks(blocks, (block) => ids.push(block.id));
  return ids;
}

export function countBlocks(blocks: readonly Block[]): number {
  return treeIds(blocks).length;
}

export function findBlock(
  blocks: readonly Block[],
  id: string,
  parentId: string | null = null,
): BlockLocation | null {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (!block) continue;
    if (block.id === id) return { block, parentId, index, siblings: blocks };
    const nested = findBlock(childrenOf(block), id, block.id);
    if (nested) return nested;
  }
  return null;
}

/** Ancestor ids of `id`, nearest first; empty at the root or when absent. */
export function ancestorIds(blocks: readonly Block[], id: string): string[] {
  const chain: string[] = [];
  let current = findBlock(blocks, id);
  while (current?.parentId) {
    chain.push(current.parentId);
    current = findBlock(blocks, current.parentId);
  }
  return chain;
}

/**
 * The tree with the sibling list under `parentId` (null is the page)
 * replaced by `edit`'s result; null when that parent is not a container in
 * the tree.
 */
export function editSiblings(
  blocks: readonly Block[],
  parentId: string | null,
  edit: (siblings: readonly Block[]) => Block[],
): Block[] | null {
  if (parentId === null) return edit(blocks);
  let found = false;
  const visit = (list: readonly Block[]): Block[] =>
    list.map((block) => {
      if (found || !isContainer(block)) return block;
      if (block.id === parentId) {
        found = true;
        return withChildren(block, edit(block.children));
      }
      const children = visit(block.children);
      return children === block.children
        ? block
        : withChildren(block, children);
    });
  const next = visit(blocks);
  return found ? next : null;
}

/** The tree with block `id` replaced by `replacement`, or null when absent. */
export function replaceBlock(
  blocks: readonly Block[],
  id: string,
  replacement: Block,
): Block[] | null {
  const location = findBlock(blocks, id);
  if (!location) return null;
  return editSiblings(blocks, location.parentId, (siblings) =>
    siblings.map((block) => (block.id === id ? replacement : block)),
  );
}

/** The tree with block `id` and its subtree removed, or null when absent. */
export function removeBlock(
  blocks: readonly Block[],
  id: string,
): Block[] | null {
  const location = findBlock(blocks, id);
  if (!location) return null;
  return editSiblings(blocks, location.parentId, (siblings) =>
    siblings.filter((block) => block.id !== id),
  );
}

export function isWithin(
  blocks: readonly Block[],
  id: string,
  ancestorId: string,
): boolean {
  return ancestorIds(blocks, id).includes(ancestorId);
}
