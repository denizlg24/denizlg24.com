import { describe, expect, test } from "bun:test";
import type { Block } from "@repo/schemas";
import { countBlocks, treeIds } from "@repo/utils/workspace-tree";
import { sectionBlocksFrom, sectionEdited } from "./section-output";

let n = 0;
const newId = () => `o${++n}`;

describe("section output", () => {
  test("a reply becomes blocks with fresh ids; a whole-reply fence is unwrapped", () => {
    const blocks = sectionBlocksFrom(
      '```markdown\n## Today\n\n- one <!-- id="evil" -->\n- two\n```',
      newId,
    );
    expect(blocks.map((b) => b.type)).toEqual(["heading", "bullet", "bullet"]);
    expect(treeIds(blocks)).not.toContain("evil");
  });

  test("sections, buttons and synced blocks are dropped, nested ones too", () => {
    const blocks = sectionBlocksFrom(
      [
        ':::section{prompt="x"}',
        "- inside",
        ":::",
        "",
        ':::block{type="button"}',
        '{"label":"x"}',
        ":::",
        "",
        "> quote",
        ">",
        ':::block{type="synced" id="s"}',
        '{"pageId":"p","blockId":"b"}',
        ":::",
        "",
        "kept",
      ].join("\n"),
      newId,
    );
    expect(blocks.map((b) => b.type)).toEqual(["quote", "paragraph"]);
    const quote = blocks[0];
    expect(quote && "children" in quote ? quote.children : null).toEqual([]);
  });

  test("whole top-level blocks only, up to the cap", () => {
    const reply = Array.from(
      { length: 30 },
      (_, i) => `- item ${i}\n  - sub`,
    ).join("\n");
    const blocks = sectionBlocksFrom(reply, newId, 9);
    expect(countBlocks(blocks)).toBe(8);
    expect(blocks).toHaveLength(4);
  });

  test("edited means children differ from the last write; blank is not an edit", () => {
    const written: Block[] = [
      { id: "a", type: "paragraph", text: [{ type: "text", text: "x" }] },
    ];
    expect(sectionEdited(written, written)).toBe(false);
    expect(
      sectionEdited(
        [{ id: "a", type: "paragraph", text: [{ type: "text", text: "y" }] }],
        written,
      ),
    ).toBe(true);
    expect(sectionEdited([], null)).toBe(false);
    expect(
      sectionEdited([{ id: "f", type: "paragraph", text: [] }], null),
    ).toBe(false);
    expect(sectionEdited(written, null)).toBe(true);
  });
});
