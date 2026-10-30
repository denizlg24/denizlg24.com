import {
  type Block,
  type BlockType,
  blockSchema,
  isContainer,
  type WorkspaceAppliedOp,
  type WorkspacePage,
} from "@repo/schemas";
import {
  canContain,
  childrenOf,
  editSiblings,
  findBlock,
  isContainerType,
  treeIds,
  walkBlocks,
} from "./workspace-tree";

export type WorkspaceOpErrorCode =
  | "MISSING_BLOCK"
  | "DUPLICATE_BLOCK"
  | "MISSING_ANCHOR"
  | "INVALID_PARENT"
  | "INVALID_BLOCK";

export class WorkspaceOpError extends Error {
  constructor(
    readonly code: WorkspaceOpErrorCode,
    readonly blockId: string | null,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceOpError";
  }
}

export interface AppliedOps {
  page: WorkspacePage;
  /** The ops as they took effect: anchors resolved, updates whole. */
  applied: WorkspaceAppliedOp[];
  /** Ops that undo `applied`, in the order they must run. */
  inverse: WorkspaceAppliedOp[];
  /** Every block id an op inserted, changed, moved or removed, subtrees included. */
  touched: string[];
  /** Lenient mode only: ops that could not apply, and why. */
  skipped: { op: WorkspaceAppliedOp; code: WorkspaceOpErrorCode }[];
}

/** The ops that address blocks, the same shape whether a client sends them or the log stores them. */
export type BlockOp = Extract<
  WorkspaceAppliedOp,
  { op: "insert" | "update" | "move" | "delete" }
>;

/** A block's own fields: everything but its id, type and children. */
export function blockFields(block: Block): Record<string, unknown> {
  const { id: _id, type: _type, ...rest } = block;
  if ("children" in rest) {
    const { children: _children, ...own } = rest;
    return own;
  }
  return rest;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ea = Object.entries(a).filter(([, v]) => v !== undefined);
  const eb = new Map(Object.entries(b).filter(([, v]) => v !== undefined));
  return (
    ea.length === eb.size &&
    ea.every(([k, v]) => eb.has(k) && deepEqual(v, eb.get(k)))
  );
}

function locate(blocks: readonly Block[], id: string) {
  const location = findBlock(blocks, id);
  if (!location) {
    throw new WorkspaceOpError("MISSING_BLOCK", id, `No block ${id}`);
  }
  return location;
}

/** The type of the parent a block would land under; throws when it cannot hold children. */
function parentType(
  blocks: readonly Block[],
  parentId: string | null,
): BlockType | null {
  if (parentId === null) return null;
  const parent = findBlock(blocks, parentId);
  if (!parent) {
    throw new WorkspaceOpError(
      "INVALID_PARENT",
      parentId,
      `No block ${parentId}`,
    );
  }
  if (!isContainer(parent.block)) {
    throw new WorkspaceOpError(
      "INVALID_PARENT",
      parentId,
      `A ${parent.block.type} block cannot hold children`,
    );
  }
  return parent.block.type;
}

function assertFits(parent: BlockType | null, block: Block) {
  walkBlocks([block], (node, nodeParentId) => {
    const holder =
      nodeParentId === null
        ? parent
        : (findBlock([block], nodeParentId)?.block.type ?? null);
    if (!canContain(holder, node.type)) {
      throw new WorkspaceOpError(
        "INVALID_PARENT",
        node.id,
        `A ${node.type} block cannot go ${holder ? `inside a ${holder} block` : "at the top of a page"}`,
      );
    }
  });
}

/** Where a block lands among `siblings`: absent appends, null is first, an id is right after it. */
function insertionIndex(
  siblings: readonly Block[],
  after: string | null | undefined,
): number {
  if (after === undefined) return siblings.length;
  if (after === null) return 0;
  const index = siblings.findIndex((block) => block.id === after);
  if (index < 0) {
    throw new WorkspaceOpError(
      "MISSING_ANCHOR",
      after,
      `No block ${after} among the target's siblings`,
    );
  }
  return index + 1;
}

function predecessor(siblings: readonly Block[], index: number): string | null {
  return index > 0 ? (siblings[index - 1]?.id ?? null) : null;
}

function parseBlock(candidate: Record<string, unknown>, id: string): Block {
  const parsed = blockSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new WorkspaceOpError(
      "INVALID_BLOCK",
      id,
      parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    );
  }
  return parsed.data;
}

/** Inserts `block` under `parentId`; returns the new tree and the anchor it took. */
function placeBlock(
  blocks: readonly Block[],
  block: Block,
  parentId: string | null,
  after: string | null | undefined,
): { blocks: Block[]; after: string | null } {
  let anchor: string | null = null;
  const next = editSiblings(blocks, parentId, (siblings) => {
    const at = insertionIndex(siblings, after);
    const list = siblings.slice();
    list.splice(at, 0, block);
    anchor = predecessor(list, at);
    return list;
  });
  if (!next) {
    throw new WorkspaceOpError(
      "INVALID_PARENT",
      parentId,
      `No block ${parentId}`,
    );
  }
  return { blocks: next, after: anchor };
}

function withoutBlock(blocks: readonly Block[], id: string): Block[] {
  const location = locate(blocks, id);
  const next = editSiblings(blocks, location.parentId, (siblings) =>
    siblings.filter((block) => block.id !== id),
  );
  if (!next) throw new WorkspaceOpError("MISSING_BLOCK", id, `No block ${id}`);
  return next;
}

function placement(parentId: string | null): { parentId?: string } {
  return parentId === null ? {} : { parentId };
}

interface Step {
  page: WorkspacePage;
  applied: WorkspaceAppliedOp;
  inverse: WorkspaceAppliedOp;
  touched: string[];
}

function applyOne(page: WorkspacePage, op: WorkspaceAppliedOp): Step {
  const blocks = page.blocks;
  switch (op.op) {
    case "insert": {
      const parentId = op.parentId ?? null;
      const holder = parentType(blocks, parentId);
      const block = parseBlock({ ...op.block }, op.block.id);
      assertFits(holder, block);
      const existing = new Set(treeIds(blocks));
      const incoming = treeIds([block]);
      const seen = new Set<string>();
      for (const id of incoming) {
        if (existing.has(id) || seen.has(id)) {
          throw new WorkspaceOpError(
            "DUPLICATE_BLOCK",
            id,
            `Block ${id} already exists`,
          );
        }
        seen.add(id);
      }
      const placed = placeBlock(blocks, block, parentId, op.after);
      return {
        page: { ...page, blocks: placed.blocks },
        applied: {
          op: "insert",
          block,
          ...placement(parentId),
          after: placed.after,
        },
        inverse: { op: "delete", id: block.id },
        touched: incoming,
      };
    }
    case "update": {
      const location = locate(blocks, op.id);
      const current = location.block;
      const type = op.type ?? current.type;
      if ("children" in op.set) {
        throw new WorkspaceOpError(
          "INVALID_BLOCK",
          op.id,
          "children change only through insert, move and delete",
        );
      }
      const children = childrenOf(current);
      if (type !== current.type) {
        const structural = ["columns", "column"];
        if (structural.includes(type) || structural.includes(current.type)) {
          throw new WorkspaceOpError(
            "INVALID_BLOCK",
            op.id,
            "Columns cannot change type",
          );
        }
        if (children.length > 0 && !isContainerType(type)) {
          throw new WorkspaceOpError(
            "INVALID_BLOCK",
            op.id,
            `A ${type} block cannot hold the children this block has`,
          );
        }
        if (!canContain(parentType(blocks, location.parentId), type)) {
          throw new WorkspaceOpError(
            "INVALID_PARENT",
            op.id,
            `A ${type} block cannot go there`,
          );
        }
      }
      const fields = op.replace
        ? op.set
        : { ...blockFields(current), ...op.set };
      const block = parseBlock(
        {
          ...fields,
          id: current.id,
          type,
          ...(isContainerType(type) ? { children } : {}),
        },
        op.id,
      );
      const next = editSiblings(blocks, location.parentId, (siblings) =>
        siblings.map((b) => (b.id === op.id ? block : b)),
      );
      if (!next) throw new WorkspaceOpError("MISSING_BLOCK", op.id, op.id);
      return {
        page: { ...page, blocks: next },
        applied: {
          op: "update",
          id: op.id,
          set: blockFields(block),
          replace: true,
          ...(type !== current.type ? { type } : {}),
        },
        inverse: {
          op: "update",
          id: op.id,
          set: blockFields(current),
          replace: true,
          ...(type !== current.type ? { type: current.type } : {}),
        },
        touched: [op.id],
      };
    }
    case "move": {
      const location = locate(blocks, op.id);
      const parentId = op.parentId ?? null;
      if (op.after === op.id) {
        throw new WorkspaceOpError(
          "MISSING_ANCHOR",
          op.id,
          "A block cannot follow itself",
        );
      }
      if (
        parentId !== null &&
        (parentId === op.id || treeIds([location.block]).includes(parentId))
      ) {
        throw new WorkspaceOpError(
          "INVALID_PARENT",
          op.id,
          "A block cannot move inside itself",
        );
      }
      const before = predecessor(location.siblings, location.index);
      const without = withoutBlock(blocks, op.id);
      const holder = parentType(without, parentId);
      assertFits(holder, location.block);
      const placed = placeBlock(without, location.block, parentId, op.after);
      return {
        page: { ...page, blocks: placed.blocks },
        applied: {
          op: "move",
          id: op.id,
          ...placement(parentId),
          after: placed.after,
        },
        inverse: {
          op: "move",
          id: op.id,
          ...placement(location.parentId),
          after: before,
        },
        touched: [op.id],
      };
    }
    case "delete": {
      const location = locate(blocks, op.id);
      return {
        page: { ...page, blocks: withoutBlock(blocks, op.id) },
        applied: { op: "delete", id: op.id },
        inverse: {
          op: "insert",
          block: location.block,
          ...placement(location.parentId),
          after: predecessor(location.siblings, location.index),
        },
        touched: treeIds([location.block]),
      };
    }
    case "page": {
      const previous: Extract<WorkspaceAppliedOp, { op: "page" }>["set"] = {};
      const set = op.set;
      if (set.title !== undefined) previous.title = page.title;
      if (set.icon !== undefined) previous.icon = page.icon;
      if (set.fullWidth !== undefined) previous.fullWidth = page.fullWidth;
      if (set.locked !== undefined) previous.locked = page.locked;
      if (set.template !== undefined)
        previous.template = page.template === true;
      if (set.parentId !== undefined) previous.parentId = page.parentId;
      if (set.order !== undefined) previous.order = page.order;
      if (set.deletedAt !== undefined) previous.deletedAt = page.deletedAt;
      const { template: _template, ...rest } = page;
      const template =
        set.template === undefined ? page.template === true : set.template;
      return {
        page: {
          ...rest,
          ...(template ? { template: true } : {}),
          ...(set.title !== undefined ? { title: set.title } : {}),
          ...(set.icon !== undefined ? { icon: set.icon } : {}),
          ...(set.fullWidth !== undefined ? { fullWidth: set.fullWidth } : {}),
          ...(set.locked !== undefined ? { locked: set.locked } : {}),
          ...(set.parentId !== undefined ? { parentId: set.parentId } : {}),
          ...(set.order !== undefined ? { order: set.order } : {}),
          ...(set.deletedAt !== undefined ? { deletedAt: set.deletedAt } : {}),
        },
        applied: op,
        inverse: { op: "page", set: previous },
        touched: [],
      };
    }
    case "replace": {
      const ids = new Set<string>();
      for (const id of treeIds(op.blocks)) {
        if (ids.has(id)) {
          throw new WorkspaceOpError(
            "DUPLICATE_BLOCK",
            id,
            `Block ${id} appears twice`,
          );
        }
        ids.add(id);
      }
      for (const block of op.blocks) assertFits(null, block);
      for (const id of treeIds(blocks)) ids.add(id);
      return {
        page: { ...page, blocks: op.blocks },
        applied: op,
        inverse: { op: "replace", blocks },
        touched: [...ids],
      };
    }
  }
}

/**
 * Applies ops in order. Strict mode throws `WorkspaceOpError` on the first op
 * that cannot apply and leaves nothing applied; lenient mode skips it.
 */
export function applyWorkspaceOps(
  page: WorkspacePage,
  ops: readonly WorkspaceAppliedOp[],
  options: { lenient?: boolean } = {},
): AppliedOps {
  let current = page;
  const applied: WorkspaceAppliedOp[] = [];
  const inverse: WorkspaceAppliedOp[] = [];
  const touched = new Set<string>();
  const skipped: AppliedOps["skipped"] = [];
  for (const op of ops) {
    try {
      const step = applyOne(current, op);
      current = step.page;
      applied.push(step.applied);
      inverse.unshift(step.inverse);
      for (const id of step.touched) touched.add(id);
    } catch (error) {
      if (options.lenient && error instanceof WorkspaceOpError) {
        skipped.push({ op, code: error.code });
        continue;
      }
      throw error;
    }
  }
  return { page: current, applied, inverse, touched: [...touched], skipped };
}

/** Block ids an op addresses: its target, the parent it lands under and the anchor it follows. */
export function opBlockIds(op: WorkspaceAppliedOp): string[] {
  switch (op.op) {
    case "insert":
      return [op.block.id, op.parentId, op.after].filter(
        (id): id is string => typeof id === "string",
      );
    case "move":
      return [op.id, op.parentId, op.after].filter(
        (id): id is string => typeof id === "string",
      );
    case "update":
    case "delete":
      return [op.id];
    case "page":
      return [];
    case "replace":
      return treeIds(op.blocks);
  }
}

/**
 * A sort key that lands a page at `index` among siblings already sorted by
 * order, without renumbering any of them.
 */
export function orderAt(
  siblingOrders: readonly number[],
  index: number,
): number {
  const at = Math.max(0, Math.min(index, siblingOrders.length));
  const before = siblingOrders[at - 1];
  const after = siblingOrders[at];
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return (after ?? 0) - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

const META_FIELDS = [
  "title",
  "icon",
  "fullWidth",
  "locked",
  "parentId",
  "order",
  "deletedAt",
] as const;

function emptyContainer(block: Block): Block {
  return isContainer(block)
    ? (parseBlock({ ...block, children: [] }, block.id) as Block)
    : block;
}

/**
 * Ops that turn tree `base` into tree `next`, every block addressed by id:
 *
 * 1. type changes into a container, so children can move in;
 * 2. every block of `next` parents first — inserted, or moved only where its
 *    parent or predecessor differs, so an insertion at the top moves nothing
 *    beneath it. A wholly new subtree is one insert;
 * 3. deletes of what `next` no longer has, outermost first;
 * 4. field updates, and type changes out of a container once its children
 *    have left or gone.
 */
export function diffBlockTrees(
  base: readonly Block[],
  next: readonly Block[],
): BlockOp[] {
  const ops: BlockOp[] = [];
  let page: WorkspacePage = {
    id: "diff",
    title: "",
    icon: null,
    parentId: null,
    order: 0,
    blocks: [...base],
    fullWidth: false,
    locked: false,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
  const emit = (op: BlockOp) => {
    page = applyOne(page, op).page;
    ops.push(op);
  };
  const baseById = new Map<string, Block>();
  walkBlocks(base, (block) => baseById.set(block.id, block));
  const nextIds = new Set(treeIds(next));
  const typeChange = (block: Block) => {
    const original = baseById.get(block.id);
    return original && original.type !== block.type ? original : null;
  };
  const updated = new Set<string>();

  walkBlocks(next, (block) => {
    if (typeChange(block) && isContainerType(block.type)) {
      emit({
        op: "update",
        id: block.id,
        set: blockFields(block),
        replace: true,
        type: block.type,
      });
      updated.add(block.id);
    }
  });

  const place = (list: readonly Block[], parentId: string | null) => {
    list.forEach((block, index) => {
      const after = index === 0 ? null : (list[index - 1]?.id ?? null);
      if (!baseById.has(block.id)) {
        const subtree = treeIds([block]);
        if (subtree.every((id) => !baseById.has(id))) {
          emit({ op: "insert", block, ...placement(parentId), after });
          return;
        }
        emit({
          op: "insert",
          block: emptyContainer(block),
          ...placement(parentId),
          after,
        });
      } else {
        const location = findBlock(page.blocks, block.id);
        const currentAfter = location
          ? predecessor(location.siblings, location.index)
          : null;
        if (location?.parentId !== parentId || currentAfter !== after) {
          emit({ op: "move", id: block.id, ...placement(parentId), after });
        }
      }
      place(childrenOf(block), block.id);
    });
  };
  place(next, null);

  const stale: string[] = [];
  const collect = (list: readonly Block[]) => {
    for (const block of list) {
      if (!nextIds.has(block.id)) stale.push(block.id);
      else collect(childrenOf(block));
    }
  };
  collect(page.blocks);
  for (const id of stale) emit({ op: "delete", id });

  walkBlocks(next, (block) => {
    const original = baseById.get(block.id);
    if (!original || updated.has(block.id)) return;
    const changed = original.type !== block.type;
    if (changed || !deepEqual(blockFields(original), blockFields(block))) {
      emit({
        op: "update",
        id: block.id,
        set: blockFields(block),
        replace: true,
        ...(changed ? { type: block.type } : {}),
      });
    }
  });
  return ops;
}

/** Ops that turn `base` into `next`: page fields first, then the block tree. */
export function diffWorkspacePages(
  base: WorkspacePage,
  next: WorkspacePage,
): WorkspaceAppliedOp[] {
  const ops: WorkspaceAppliedOp[] = [];
  const set: Extract<WorkspaceAppliedOp, { op: "page" }>["set"] = {};
  let metaChanged = false;
  for (const field of META_FIELDS) {
    if (base[field] !== next[field]) {
      metaChanged = true;
      Object.assign(set, { [field]: next[field] });
    }
  }
  if (metaChanged) ops.push({ op: "page", set });
  return [...ops, ...diffBlockTrees(base.blocks, next.blocks)];
}
