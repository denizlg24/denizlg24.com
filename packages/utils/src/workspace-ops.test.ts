import { describe, expect, test } from "bun:test";
import type { Block, WorkspaceAppliedOp } from "@repo/schemas";
import { genBlock, genPage, type Rng, rng } from "./workspace-gen.test-util";
import {
  applyWorkspaceOps,
  deepEqual,
  diffWorkspacePages,
  WorkspaceOpError,
} from "./workspace-ops";
import {
  canContain,
  childrenOf,
  editSiblings,
  findBlock,
  removeBlock,
  replaceBlock,
  treeIds,
  walkBlocks,
} from "./workspace-tree";

const para = (id: string, text = id): Block => ({
  id,
  type: "paragraph",
  text: [{ type: "text", text }],
});
const toggle = (id: string, children: Block[] = []): Block => ({
  id,
  type: "toggle",
  text: [{ type: "text", text: id }],
  children,
});

const ids = (blocks: readonly Block[]) => blocks.map((b) => b.id);

function containers(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  walkBlocks(blocks, (block) => {
    if ("children" in block) out.push(block);
  });
  return out;
}

/** A random valid tree reachable from `blocks` by inserts, deletes, moves, edits and type changes. */
function mutate(r: Rng, blocks: Block[]): Block[] {
  let next = blocks.slice();
  const steps = r.int(6);
  for (let i = 0; i < steps; i++) {
    const all = treeIds(next);
    const roll = r.next();
    const parents = [null, ...containers(next)];
    if (roll < 0.25 || all.length === 0) {
      const parent = r.pick(parents);
      const block = genBlock(r, 1, parent?.type ?? null);
      next =
        editSiblings(next, parent?.id ?? null, (list) => {
          const copy = list.slice();
          copy.splice(r.int(copy.length + 1), 0, block);
          return copy;
        }) ?? next;
    } else if (roll < 0.45) {
      next = removeBlock(next, r.pick(all)) ?? next;
    } else if (roll < 0.7) {
      const id = r.pick(all);
      const moving = findBlock(next, id)?.block;
      if (!moving) continue;
      const inside = new Set(treeIds([moving]));
      const targets = parents.filter(
        (p) =>
          !(p && inside.has(p.id)) && canContain(p?.type ?? null, moving.type),
      );
      if (targets.length === 0) continue;
      const target = r.pick(targets);
      const without = removeBlock(next, id) ?? next;
      next =
        editSiblings(without, target?.id ?? null, (list) => {
          const copy = list.slice();
          copy.splice(r.int(copy.length + 1), 0, moving);
          return copy;
        }) ?? next;
    } else {
      const id = r.pick(all);
      const location = findBlock(next, id);
      if (
        !location ||
        location.block.type === "column" ||
        location.block.type === "columns"
      )
        continue;
      const holder = location.parentId
        ? (findBlock(next, location.parentId)?.block.type ?? null)
        : null;
      let fresh = genBlock(r, 1, holder);
      if (fresh.type === "columns") continue;
      if ("children" in fresh) {
        const kept = childrenOf(location.block).filter((c) =>
          canContain(fresh.type, c.type),
        );
        fresh = { ...fresh, children: kept } as Block;
      }
      next = replaceBlock(next, id, { ...fresh, id }) ?? next;
    }
  }
  return next;
}

describe("applyWorkspaceOps", () => {
  const page = genPage(rng(1), [
    para("a"),
    toggle("b", [para("b1")]),
    para("c"),
  ]);

  test("insert, move, update and delete address blocks by id, at any depth", () => {
    const { page: next, applied } = applyWorkspaceOps(page, [
      { op: "insert", block: para("x"), after: "a" },
      { op: "move", id: "c", parentId: "b", after: "b1" },
      { op: "update", id: "b1", set: { text: [{ type: "text", text: "B" }] } },
      { op: "insert", block: para("y"), parentId: "b", after: null },
      { op: "delete", id: "a" },
    ]);
    expect(ids(next.blocks)).toEqual(["x", "b"]);
    expect(ids(childrenOf(next.blocks[1] as Block))).toEqual(["y", "b1", "c"]);
    expect(applied[0]).toEqual({ op: "insert", block: para("x"), after: "a" });
    expect(applied[1]).toEqual({
      op: "move",
      id: "c",
      parentId: "b",
      after: "b1",
    });
  });

  test("delete removes the subtree and its inverse puts it back", () => {
    const result = applyWorkspaceOps(page, [{ op: "delete", id: "b" }]);
    expect(ids(result.page.blocks)).toEqual(["a", "c"]);
    expect(result.touched.sort()).toEqual(["b", "b1"]);
    const undone = applyWorkspaceOps(result.page, result.inverse);
    expect(deepEqual(undone.page, page)).toBe(true);
  });

  test("a missing anchor, a duplicate id, a leaf parent and a cycle are refused", () => {
    expect(() =>
      applyWorkspaceOps(page, [{ op: "move", id: "a", after: "zz" }]),
    ).toThrow(WorkspaceOpError);
    expect(() =>
      applyWorkspaceOps(page, [{ op: "insert", block: para("b1") }]),
    ).toThrow(/already exists/);
    expect(() =>
      applyWorkspaceOps(page, [
        { op: "insert", block: para("n"), parentId: "a" },
      ]),
    ).toThrow(/cannot hold children/);
    expect(() =>
      applyWorkspaceOps(page, [{ op: "move", id: "b", parentId: "b1" }]),
    ).toThrow(/inside itself|cannot hold/);
    expect(() =>
      applyWorkspaceOps(page, [
        {
          op: "insert",
          block: { id: "col", type: "column", width: 1, children: [] },
        },
      ]),
    ).toThrow(/cannot go/);
  });

  test("an update keeps id and children; a type change must fit them", () => {
    const { page: next } = applyWorkspaceOps(page, [
      { op: "update", id: "a", set: { id: "z", level: 2 }, type: "heading" },
    ]);
    expect(next.blocks[0]).toEqual({
      id: "a",
      type: "heading",
      level: 2,
      text: [{ type: "text", text: "a" }],
    });
    expect(() =>
      applyWorkspaceOps(page, [
        { op: "update", id: "b", set: {}, type: "paragraph" },
      ]),
    ).toThrow(/children/);
    const turned = applyWorkspaceOps(page, [
      { op: "update", id: "b", set: {}, type: "callout" },
    ]).page.blocks[1];
    expect(turned?.type === "callout" && ids(turned.children)).toEqual(["b1"]);
    expect(() =>
      applyWorkspaceOps(page, [
        { op: "update", id: "b", set: { children: [] } },
      ]),
    ).toThrow(/children/);
  });

  test("lenient mode skips what cannot apply", () => {
    const result = applyWorkspaceOps(
      page,
      [
        { op: "delete", id: "nope" },
        { op: "delete", id: "a" },
      ],
      { lenient: true },
    );
    expect(ids(result.page.blocks)).toEqual(["b", "c"]);
    expect(result.skipped.map((s) => s.code)).toEqual(["MISSING_BLOCK"]);
  });

  test("the inverse undoes any op sequence (property)", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = rng(seed);
      const start = genPage(r);
      const target = { ...start, blocks: mutate(r, start.blocks), title: "t" };
      const ops = diffWorkspacePages(start, target);
      const done = applyWorkspaceOps(start, ops);
      const undone = applyWorkspaceOps(done.page, done.inverse);
      if (!deepEqual(undone.page, start)) throw new Error(`seed ${seed}`);
    }
  });

  test("replaying applied ops reproduces the page (property)", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const start = genPage(r);
      const target = { ...start, blocks: mutate(r, start.blocks) };
      const once = applyWorkspaceOps(start, diffWorkspacePages(start, target));
      const replay = applyWorkspaceOps(start, once.applied);
      if (!deepEqual(replay.page, once.page)) throw new Error(`seed ${seed}`);
    }
  });
});

describe("diffWorkspacePages", () => {
  test("turns base into next, nested trees and type changes included (property)", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const r = rng(seed);
      const base = genPage(r);
      const next = { ...base, blocks: mutate(r, base.blocks) };
      let page: Block[];
      try {
        page = applyWorkspaceOps(base, diffWorkspacePages(base, next)).page
          .blocks;
      } catch (error) {
        throw new Error(`seed ${seed}: ${error}`);
      }
      if (!deepEqual(page, next.blocks)) {
        throw new Error(
          `seed ${seed}\n${JSON.stringify(base.blocks)}\n${JSON.stringify(next.blocks)}\n${JSON.stringify(page)}`,
        );
      }
    }
  });

  test("an insertion at the top moves nothing beneath it", () => {
    const base = genPage(rng(2), [para("a"), para("b"), para("c")]);
    const ops = diffWorkspacePages(base, {
      ...base,
      blocks: [para("n"), ...base.blocks],
    });
    expect(ops).toEqual([{ op: "insert", block: para("n"), after: null }]);
  });

  test("typing in a nested paragraph is one update", () => {
    const base = genPage(rng(4), [toggle("t", [para("p", "hel")])]);
    const ops = diffWorkspacePages(base, {
      ...base,
      blocks: [toggle("t", [para("p", "hello")])],
    });
    expect(ops).toEqual([
      {
        op: "update",
        id: "p",
        set: { text: [{ type: "text", text: "hello" }] },
        replace: true,
      },
    ]);
  });

  test("wrapping existing blocks in a new toggle moves them in", () => {
    const base = genPage(rng(5), [para("a"), para("b")]);
    const ops = diffWorkspacePages(base, {
      ...base,
      blocks: [toggle("t", [para("a"), para("b")])],
    });
    expect(ops.map((op) => op.op)).toEqual(["insert", "move", "move"]);
  });

  test("meta changes become one page op", () => {
    const base = genPage(rng(3), []);
    const ops: WorkspaceAppliedOp[] = diffWorkspacePages(base, {
      ...base,
      title: "New",
      deletedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(ops).toEqual([
      {
        op: "page",
        set: { title: "New", deletedAt: "2026-10-02T00:00:00.000Z" },
      },
    ]);
  });
});
