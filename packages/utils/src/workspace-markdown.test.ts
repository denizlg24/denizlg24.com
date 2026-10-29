import { describe, expect, test } from "bun:test";
import { genBlocks, rng } from "./workspace-gen.test-util";
import { blocksToMarkdown, markdownToBlocks } from "./workspace-markdown";

let fresh = 0;
const newId = () => `new${++fresh}`;

describe("workspace markdown", () => {
  test("blocksToMarkdown then markdownToBlocks is lossless (property)", () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const blocks = genBlocks(rng(seed));
      const markdown = blocksToMarkdown(blocks);
      const parsed = markdownToBlocks(markdown, { newId });
      if (JSON.stringify(parsed) !== JSON.stringify(blocks)) {
        throw new Error(
          `seed ${seed} did not round-trip\n${markdown}\n${JSON.stringify(blocks)}\n${JSON.stringify(parsed)}`,
        );
      }
    }
  });

  test("markdown → blocks → markdown is stable for its own output (property)", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const markdown = blocksToMarkdown(genBlocks(rng(seed)));
      expect(blocksToMarkdown(markdownToBlocks(markdown, { newId }))).toBe(
        markdown,
      );
    }
  });

  test("heading, text and todo read as ordinary markdown", () => {
    const markdown = blocksToMarkdown([
      { id: "h", span: 6, type: "heading", text: "Week" },
      { id: "t", span: 6, type: "text", markdown: "Ship **v2**." },
      {
        id: "d",
        span: 3,
        type: "todo",
        items: [{ id: "i1", text: "Write tests", done: true }],
      },
      { id: "a", span: 3, type: "agenda" },
    ]);
    expect(markdown).toContain("## Week");
    expect(markdown).toContain("Ship **v2**.");
    expect(markdown).toContain("- [x] Write tests");
    expect(markdown).toContain(':::block{type="agenda" id="a" span=3}');
  });

  test("hand-written markdown splits into blocks with fresh ids", () => {
    const blocks = markdownToBlocks(
      '# Plan\n\nFirst paragraph\nstill first\n\nSecond\n\n- [ ] a\n- [x] b\n\n---\n\n:::block{type="links"}\n{"refs":["page:home"]}\n:::',
      { newId },
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "text",
      "todo",
      "divider",
      "links",
    ]);
    const text = blocks[1];
    expect(text?.type === "text" && text.markdown).toBe(
      "First paragraph\nstill first\n\nSecond",
    );
    const links = blocks[4];
    expect(links?.type === "links" && links.refs).toEqual(["page:home"]);
    expect(links?.span).toBe(6);
  });

  test("markdown appended after a text block becomes new blocks", () => {
    const markdown = blocksToMarkdown([
      { id: "t", span: 6, type: "text", markdown: "## inside\nbody" },
    ]);
    const blocks = markdownToBlocks(`${markdown}\n\n## After\n\nMore`, {
      newId,
    });
    expect(blocks.map((b) => [b.id.startsWith("new"), b.type])).toEqual([
      [false, "text"],
      [true, "heading"],
      [true, "text"],
    ]);
    const first = blocks[0];
    expect(first?.type === "text" && first.markdown).toBe("## inside\nbody");
  });

  test("an invalid directive is refused with its line", () => {
    expect(() =>
      markdownToBlocks(':::block{type="nope"}\n:::', { newId }),
    ).toThrow(/Line 1/);
    expect(() =>
      markdownToBlocks(':::block{type="agenda"}', { newId }),
    ).toThrow(/Unclosed/);
  });
});
