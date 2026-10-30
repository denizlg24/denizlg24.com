import { describe, expect, test } from "bun:test";
import { type Block, type LegacyBlock, legacyBlockSchema } from "@repo/schemas";
import { genBlock, genLegacyBlock, rng } from "./workspace-gen.test-util";
import {
  downgradeBlocks,
  legacyBlockToFlow,
  upgradeLegacyBlocks,
} from "./workspace-legacy";
import { deepEqual } from "./workspace-ops";
import { treeIds } from "./workspace-tree";

let fresh = 0;
const newId = () => `new${++fresh}`;

const text = (
  id: string,
  span: 2 | 3 | 4 | 6,
  markdown: string,
): LegacyBlock => ({
  id,
  span,
  type: "text",
  markdown,
});

describe("v1 grid → flow", () => {
  test("rows pack by span; a row of several becomes proportional columns", () => {
    const flow = upgradeLegacyBlocks([
      { id: "g", span: 6, type: "greeting" },
      { id: "a", span: 4, type: "agenda" },
      { id: "t", span: 2, type: "tasks" },
      { id: "h", span: 3, type: "heading", text: "Notes" },
      { id: "x", span: 4, type: "llm" },
    ]);
    expect(flow.map((b) => b.type)).toEqual([
      "greeting",
      "columns",
      "heading",
      "llm",
    ]);
    const row = flow[1];
    expect(
      row?.type === "columns" &&
        row.children.map((c) => [c.width, c.children[0]?.id]),
    ).toEqual([
      [4 / 6, "a"],
      [2 / 6, "t"],
    ]);
  });

  test("a text block's markdown becomes blocks; the first keeps its id", () => {
    const [heading, para, list] = upgradeLegacyBlocks([
      text("t", 6, "## Plan\n\nShip **v2**\n\n- a\n  - b"),
    ]);
    expect(heading).toEqual({
      id: "t",
      type: "heading",
      level: 2,
      text: [{ type: "text", text: "Plan" }],
    });
    expect(para?.id).toBe("t-1");
    expect(list?.type === "bullet" && list.children[0]?.type).toBe("bullet");
  });

  test("the conversion is deterministic and every id is unique (property)", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = rng(seed);
      const grid = Array.from({ length: r.int(8) }, () => genLegacyBlock(r));
      const once = upgradeLegacyBlocks(grid);
      expect(deepEqual(upgradeLegacyBlocks(grid), once)).toBe(true);
      const ids = treeIds(once);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("flow → v1 for desktop 3.0.0", () => {
  test("every block downgrades to a valid v1 block that converts back to itself (property)", () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const block = genBlock(rng(seed));
      const legacy = downgradeBlocks([block]);
      for (const item of legacy) legacyBlockSchema.parse(item);
      if (block.type === "columns") continue;
      expect(legacy).toHaveLength(1);
      const [only] = legacy;
      if (!only) throw new Error("no block");
      const back = legacyBlockToFlow(only, newId);
      if (!deepEqual(back, [block])) {
        throw new Error(
          `seed ${seed}\n${JSON.stringify(block)}\n${JSON.stringify(only)}\n${JSON.stringify(back)}`,
        );
      }
    }
  });

  test("a record embed and a view become v1 text blocks holding their directive", () => {
    const blocks: Block[] = [
      { id: "r", type: "record", ref: "entity:paper:p9", mode: "card" },
      {
        id: "v",
        type: "view",
        source: "finance-entries",
        layout: "table",
        filters: [{ field: "currency", op: "is", value: "EUR" }],
        sort: [],
        limit: 25,
      },
    ];
    const legacy = downgradeBlocks(blocks);
    expect(legacy.map((b) => [b.id, b.type, b.span])).toEqual([
      ["r", "text", 6],
      ["v", "text", 6],
    ]);
    const [record, view] = legacy;
    expect(record?.type === "text" && record.markdown).toBe(
      ':::block{type="record" id="r"}\n{"ref":"entity:paper:p9","mode":"card"}\n:::',
    );
    expect(view?.type === "text" && view.markdown).toContain(
      '"source":"finance-entries"',
    );
    expect(legacy.flatMap((item) => legacyBlockToFlow(item, newId))).toEqual(
      blocks,
    );
  });

  test("a button becomes a v1 text block holding its directive", () => {
    const button: Block = {
      id: "btn",
      type: "button",
      label: "Log {{date}}",
      mode: "actions",
      actions: [
        { kind: "append-blocks", pageId: "$this", markdown: "- {{time}}" },
        { kind: "open", url: "/dashboard" },
      ],
      agentPrompt: "",
    };
    const [legacy] = downgradeBlocks([button]);
    expect(legacy?.type).toBe("text");
    expect(legacy?.type === "text" && legacy.markdown).toStartWith(
      ':::block{type="button" id="btn"}',
    );
    expect(legacy ? legacyBlockToFlow(legacy, newId) : []).toEqual([button]);
  });

  test("an agent section becomes one v1 text block holding its directive and children", () => {
    const section: Block = {
      id: "sec",
      type: "section",
      title: "Today",
      prompt: "Summarise",
      schedule: { cron: "0 7 * * *", timeZone: "UTC" },
      sources: [],
      pinned: false,
      children: [
        {
          id: "c",
          type: "paragraph",
          text: [{ type: "text", text: "body" }],
        },
      ],
    };
    const legacy = downgradeBlocks([section]);
    expect(legacy).toHaveLength(1);
    const [only] = legacy;
    expect(only?.type === "text" && only.markdown).toStartWith(
      ':::section{id="sec"',
    );
    expect(only ? legacyBlockToFlow(only, newId) : []).toEqual([section]);
  });

  test("columns flatten into spans, ids kept", () => {
    const legacy = downgradeBlocks([
      {
        id: "row",
        type: "columns",
        children: [
          {
            id: "c1",
            type: "column",
            width: 2,
            children: [{ id: "a", type: "agenda" }],
          },
          {
            id: "c2",
            type: "column",
            width: 1,
            children: [{ id: "t", type: "tasks" }],
          },
        ],
      },
    ]);
    expect(legacy.map((b) => [b.id, b.span])).toEqual([
      ["a", 4],
      ["t", 2],
    ]);
  });
});
