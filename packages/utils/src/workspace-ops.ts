import {
  type Block,
  blockSchema,
  type WorkspaceAppliedOp,
  type WorkspacePage,
} from "@repo/schemas";

export type WorkspaceOpErrorCode =
  | "MISSING_BLOCK"
  | "DUPLICATE_BLOCK"
  | "MISSING_ANCHOR"
  | "NESTING_UNSUPPORTED"
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
  /** Every block id an op inserted, changed, moved or removed. */
  touched: string[];
  /** Lenient mode only: ops that could not apply, and why. */
  skipped: { op: WorkspaceAppliedOp; code: WorkspaceOpErrorCode }[];
}

export function blockFields(block: Block): Record<string, unknown> {
  const { id: _id, type: _type, ...rest } = block;
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

function rootOnly(parentId: string | null | undefined, id: string | null) {
  if (parentId !== null && parentId !== undefined) {
    throw new WorkspaceOpError(
      "NESTING_UNSUPPORTED",
      id,
      "Blocks cannot be nested yet; omit parentId",
    );
  }
}

function indexOf(blocks: Block[], id: string): number {
  const index = blocks.findIndex((block) => block.id === id);
  if (index < 0) {
    throw new WorkspaceOpError("MISSING_BLOCK", id, `No block ${id}`);
  }
  return index;
}

/** Where a block lands: absent appends, null is first, an id is right after it. */
function insertionIndex(
  blocks: Block[],
  after: string | null | undefined,
): number {
  if (after === undefined) return blocks.length;
  if (after === null) return 0;
  const index = blocks.findIndex((block) => block.id === after);
  if (index < 0) {
    throw new WorkspaceOpError("MISSING_ANCHOR", after, `No block ${after}`);
  }
  return index + 1;
}

function predecessor(blocks: Block[], index: number): string | null {
  return index > 0 ? (blocks[index - 1]?.id ?? null) : null;
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
      rootOnly(op.parentId, op.block.id);
      if (blocks.some((block) => block.id === op.block.id)) {
        throw new WorkspaceOpError(
          "DUPLICATE_BLOCK",
          op.block.id,
          `Block ${op.block.id} already exists`,
        );
      }
      const at = insertionIndex(blocks, op.after);
      const next = blocks.slice();
      next.splice(at, 0, op.block);
      return {
        page: { ...page, blocks: next },
        applied: {
          op: "insert",
          block: op.block,
          after: predecessor(next, at),
        },
        inverse: { op: "delete", id: op.block.id },
        touched: [op.block.id],
      };
    }
    case "update": {
      const at = indexOf(blocks, op.id);
      const current = blocks[at];
      if (!current) throw new WorkspaceOpError("MISSING_BLOCK", op.id, op.id);
      const merged = op.replace
        ? { ...op.set, id: current.id, type: current.type }
        : { ...current, ...op.set, id: current.id, type: current.type };
      const block = parseBlock(merged, op.id);
      const next = blocks.slice();
      next[at] = block;
      return {
        page: { ...page, blocks: next },
        applied: {
          op: "update",
          id: op.id,
          set: blockFields(block),
          replace: true,
        },
        inverse: {
          op: "update",
          id: op.id,
          set: blockFields(current),
          replace: true,
        },
        touched: [op.id],
      };
    }
    case "move": {
      rootOnly(op.parentId, op.id);
      const from = indexOf(blocks, op.id);
      const block = blocks[from];
      if (!block) throw new WorkspaceOpError("MISSING_BLOCK", op.id, op.id);
      if (op.after === op.id) {
        throw new WorkspaceOpError(
          "MISSING_ANCHOR",
          op.id,
          "A block cannot follow itself",
        );
      }
      const before = predecessor(blocks, from);
      const next = blocks.slice();
      next.splice(from, 1);
      const at = insertionIndex(next, op.after);
      next.splice(at, 0, block);
      return {
        page: { ...page, blocks: next },
        applied: { op: "move", id: op.id, after: predecessor(next, at) },
        inverse: { op: "move", id: op.id, after: before },
        touched: [op.id],
      };
    }
    case "delete": {
      const at = indexOf(blocks, op.id);
      const block = blocks[at];
      if (!block) throw new WorkspaceOpError("MISSING_BLOCK", op.id, op.id);
      const next = blocks.slice();
      next.splice(at, 1);
      return {
        page: { ...page, blocks: next },
        applied: { op: "delete", id: op.id },
        inverse: { op: "insert", block, after: predecessor(blocks, at) },
        touched: [op.id],
      };
    }
    case "page": {
      const previous: Extract<WorkspaceAppliedOp, { op: "page" }>["set"] = {};
      const set = op.set;
      if (set.title !== undefined) previous.title = page.title;
      if (set.icon !== undefined) previous.icon = page.icon;
      if (set.fullWidth !== undefined) previous.fullWidth = page.fullWidth;
      if (set.locked !== undefined) previous.locked = page.locked;
      if (set.parentId !== undefined) previous.parentId = page.parentId;
      if (set.order !== undefined) previous.order = page.order;
      if (set.deletedAt !== undefined) previous.deletedAt = page.deletedAt;
      return {
        page: {
          ...page,
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
      for (const block of op.blocks) {
        if (ids.has(block.id)) {
          throw new WorkspaceOpError(
            "DUPLICATE_BLOCK",
            block.id,
            `Block ${block.id} appears twice`,
          );
        }
        ids.add(block.id);
      }
      for (const block of blocks) ids.add(block.id);
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

/** Block ids an op addresses: its target and the anchor it is placed after. */
export function opBlockIds(op: WorkspaceAppliedOp): string[] {
  switch (op.op) {
    case "insert":
      return op.after ? [op.block.id, op.after] : [op.block.id];
    case "move":
      return op.after ? [op.id, op.after] : [op.id];
    case "update":
    case "delete":
      return [op.id];
    case "page":
      return [];
    case "replace":
      return op.blocks.map((block) => block.id);
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

/**
 * Ops that turn `base` into `next`: meta first, then deletes, then each block
 * of `next` in order — inserted, moved or updated only where it differs. A
 * block already right after its predecessor is not moved, so an insertion at
 * the top does not reorder everything beneath it.
 */
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

  const nextIds = new Set(next.blocks.map((block) => block.id));
  let working = base.blocks.filter((block) => {
    if (nextIds.has(block.id)) return true;
    ops.push({ op: "delete", id: block.id });
    return false;
  });
  const baseById = new Map(base.blocks.map((block) => [block.id, block]));

  next.blocks.forEach((block, index) => {
    const after = index === 0 ? null : (next.blocks[index - 1]?.id ?? null);
    const original = baseById.get(block.id);
    if (!original) {
      ops.push({ op: "insert", block, after });
      const at =
        after === null ? 0 : working.findIndex((b) => b.id === after) + 1;
      working = [...working.slice(0, at), block, ...working.slice(at)];
      return;
    }
    const position = working.findIndex((b) => b.id === block.id);
    const currentAfter = predecessor(working, position);
    if (currentAfter !== after) {
      ops.push({ op: "move", id: block.id, after });
      const without = working.filter((b) => b.id !== block.id);
      const at =
        after === null ? 0 : without.findIndex((b) => b.id === after) + 1;
      working = [...without.slice(0, at), block, ...without.slice(at)];
    }
    if (original.type !== block.type) {
      ops.push({ op: "delete", id: block.id });
      ops.push({ op: "insert", block, after });
    } else if (!deepEqual(original, block)) {
      ops.push({
        op: "update",
        id: block.id,
        set: blockFields(block),
        replace: true,
      });
    }
  });
  return ops;
}
