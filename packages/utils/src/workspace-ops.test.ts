import { describe, expect, test } from "bun:test";
import type { Block, WorkspaceAppliedOp } from "@repo/schemas";
import { genBlock, genPage, type Rng, rng } from "./workspace-gen.test-util";
import {
  applyWorkspaceOps,
  diffWorkspacePages,
  WorkspaceOpError,
} from "./workspace-ops";

const text = (id: string, markdown = id): Block => ({
  id,
  span: 6,
  type: "text",
  markdown,
});

const ids = (blocks: Block[]) => blocks.map((b) => b.id);

function mutate(r: Rng, blocks: Block[]): Block[] {
  let next = blocks.slice();
  const steps = r.int(6);
  for (let i = 0; i < steps; i++) {
    const roll = r.next();
    if (roll < 0.25 || next.length === 0) {
      next.splice(r.int(next.length + 1), 0, genBlock(r));
    } else if (roll < 0.45) {
      next.splice(r.int(next.length), 1);
    } else if (roll < 0.7) {
      const [moved] = next.splice(r.int(next.length), 1);
      if (moved) next.splice(r.int(next.length + 1), 0, moved);
    } else {
      const at = r.int(next.length);
      const source = next[at];
      if (source) next[at] = { ...genBlock(r), id: source.id };
    }
  }
  next = next.filter(
    (block, index) => next.findIndex((b) => b.id === block.id) === index,
  );
  return next;
}

describe("applyWorkspaceOps", () => {
  const page = genPage(rng(1), [text("a"), text("b"), text("c")]);

  test("insert, move, update and delete address blocks by id", () => {
    const { page: next, applied } = applyWorkspaceOps(page, [
      { op: "insert", block: text("x"), after: "a" },
      { op: "move", id: "c", after: null },
      { op: "update", id: "b", set: { markdown: "B", span: 3 } },
      { op: "delete", id: "a" },
    ]);
    expect(ids(next.blocks)).toEqual(["c", "x", "b"]);
    expect(next.blocks[2]).toEqual({
      id: "b",
      span: 3,
      type: "text",
      markdown: "B",
    });
    expect(applied[0]).toEqual({ op: "insert", block: text("x"), after: "a" });
  });

  test("a missing anchor, a duplicate id and nesting are refused", () => {
    expect(() =>
      applyWorkspaceOps(page, [{ op: "move", id: "a", after: "zz" }]),
    ).toThrow(WorkspaceOpError);
    expect(() =>
      applyWorkspaceOps(page, [{ op: "insert", block: text("a") }]),
    ).toThrow(/already exists/);
    expect(() =>
      applyWorkspaceOps(page, [
        { op: "insert", block: text("n"), parentId: "a" },
      ]),
    ).toThrow(/nested/);
  });

  test("an update cannot change a block's type or make it invalid", () => {
    const { page: next } = applyWorkspaceOps(page, [
      { op: "update", id: "a", set: { type: "agenda", id: "z" } },
    ]);
    expect(next.blocks[0]?.type).toBe("text");
    expect(next.blocks[0]?.id).toBe("a");
    expect(() =>
      applyWorkspaceOps(page, [{ op: "update", id: "a", set: { span: 5 } }]),
    ).toThrow(/span/);
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
      expect(JSON.stringify(undone.page)).toBe(JSON.stringify(start));
    }
  });

  test("replaying applied ops reproduces the page (property)", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const start = genPage(r);
      const target = { ...start, blocks: mutate(r, start.blocks) };
      const once = applyWorkspaceOps(start, diffWorkspacePages(start, target));
      const replay = applyWorkspaceOps(start, once.applied);
      expect(JSON.stringify(replay.page)).toBe(JSON.stringify(once.page));
    }
  });
});

describe("diffWorkspacePages", () => {
  test("turns base into next (property)", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const r = rng(seed);
      const base = genPage(r);
      const next = { ...base, blocks: mutate(r, base.blocks) };
      const { page } = applyWorkspaceOps(base, diffWorkspacePages(base, next));
      expect(JSON.stringify(page.blocks)).toBe(JSON.stringify(next.blocks));
    }
  });

  test("an insertion at the top moves nothing beneath it", () => {
    const base = genPage(rng(2), [text("a"), text("b"), text("c")]);
    const ops = diffWorkspacePages(base, {
      ...base,
      blocks: [text("n"), ...base.blocks],
    });
    expect(ops).toEqual([{ op: "insert", block: text("n"), after: null }]);
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
