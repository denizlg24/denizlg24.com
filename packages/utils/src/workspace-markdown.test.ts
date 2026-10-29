import { describe, expect, test } from "bun:test";
import type { Block } from "@repo/schemas";
import { genBlocks, genRichText, rng } from "./workspace-gen.test-util";
import { blocksToMarkdown, markdownToBlocks } from "./workspace-markdown";
import { deepEqual } from "./workspace-ops";
import { markdownToRuns, runsToMarkdown } from "./workspace-rich-text";

let fresh = 0;
const newId = () => `new${++fresh}`;

describe("inline rich text", () => {
  test("runsToMarkdown then markdownToRuns is lossless (property)", () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const runs = genRichText(rng(seed));
      const markdown = runsToMarkdown(runs);
      const parsed = markdownToRuns(markdown);
      if (!deepEqual(parsed, runs)) {
        throw new Error(
          `seed ${seed} did not round-trip\n${markdown}\n${JSON.stringify(runs)}\n${JSON.stringify(parsed)}`,
        );
      }
    }
  });

  test("hand-written marks, links and mentions", () => {
    expect(
      markdownToRuns(
        "a **bold** _it_ ~~gone~~ `x` [site](https://a.b) [@Ana](person:p1) [@](page:home) snake_case",
      ),
    ).toEqual([
      { type: "text", text: "a " },
      { type: "text", text: "bold", bold: true },
      { type: "text", text: " " },
      { type: "text", text: "it", italic: true },
      { type: "text", text: " " },
      { type: "text", text: "gone", strike: true },
      { type: "text", text: " " },
      { type: "text", text: "x", code: true },
      { type: "text", text: " " },
      { type: "text", text: "site", link: "https://a.b" },
      { type: "text", text: " " },
      { type: "mention", kind: "person", id: "p1", label: "Ana" },
      { type: "text", text: " " },
      { type: "mention", kind: "page", id: "home" },
      { type: "text", text: " snake_case" },
    ]);
  });
});

describe("workspace markdown", () => {
  test("blocksToMarkdown then markdownToBlocks is lossless for nested trees (property)", () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const blocks = genBlocks(rng(seed));
      const markdown = blocksToMarkdown(blocks);
      let parsed: Block[];
      try {
        parsed = markdownToBlocks(markdown, { newId });
      } catch (error) {
        throw new Error(`seed ${seed} failed to parse: ${error}\n${markdown}`);
      }
      if (!deepEqual(parsed, blocks)) {
        throw new Error(
          `seed ${seed} did not round-trip\n${markdown}\n${JSON.stringify(blocks)}\n${JSON.stringify(parsed)}`,
        );
      }
    }
  });

  test("markdown → blocks → markdown is stable for its own output (property)", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const markdown = blocksToMarkdown(genBlocks(rng(seed)));
      expect(blocksToMarkdown(markdownToBlocks(markdown, { newId }))).toBe(
        markdown,
      );
    }
  });

  test("text blocks read as ordinary markdown", () => {
    const markdown = blocksToMarkdown([
      {
        id: "h",
        type: "heading",
        level: 2,
        text: [{ type: "text", text: "Week" }],
      },
      {
        id: "p",
        type: "paragraph",
        text: [
          { type: "text", text: "Ship " },
          { type: "text", text: "v2", bold: true },
        ],
      },
      {
        id: "b",
        type: "bullet",
        text: [{ type: "text", text: "parent" }],
        children: [
          {
            id: "t",
            type: "todo",
            text: [{ type: "text", text: "Write tests" }],
            checked: true,
            children: [],
          },
        ],
      },
      { id: "a", type: "agenda" },
    ]);
    expect(markdown).toContain('## Week <!-- id="h" -->');
    expect(markdown).toContain("Ship **v2**");
    expect(markdown).toContain('- parent <!-- id="b" -->\n  - [x] Write tests');
    expect(markdown).toContain(':::block{type="agenda" id="a"}');
  });

  test("toggles are <details>, columns are directives", () => {
    const markdown = blocksToMarkdown([
      {
        id: "t",
        type: "toggle",
        text: [{ type: "text", text: "More" }],
        children: [
          {
            id: "p",
            type: "paragraph",
            text: [{ type: "text", text: "inside" }],
          },
        ],
      },
      {
        id: "c",
        type: "columns",
        children: [
          {
            id: "c1",
            type: "column",
            width: 0.5,
            children: [{ id: "g", type: "greeting" }],
          },
          { id: "c2", type: "column", width: 0.5, children: [] },
        ],
      },
    ]);
    expect(markdown).toContain("<details>");
    expect(markdown).toContain("<summary>More</summary>");
    expect(markdown).toContain(':::columns{id="c"}');
    expect(markdown).toContain(':::column{id="c1" width=0.5}');
  });

  test("hand-written markdown nests lists and gets fresh ids", () => {
    const blocks = markdownToBlocks(
      '# Plan\n\nFirst paragraph\nstill first\n\n- a\n  - a.1\n    - [x] done\n- b\n\n1. one\n2. two\n\n> quoted\n\n```ts\nconst x = 1;\n```\n\n---\n\n<details><summary>Hidden</summary>\n\nbody\n</details>\n\n:::block{type="links"}\n{"refs":["page:home"]}\n:::',
      { newId },
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "bullet",
      "bullet",
      "numbered",
      "numbered",
      "quote",
      "code",
      "divider",
      "toggle",
      "links",
    ]);
    const nested = blocks[2];
    expect(nested?.type === "bullet" && nested.children[0]?.type).toBe(
      "bullet",
    );
    const deeper =
      nested?.type === "bullet" && nested.children[0]?.type === "bullet"
        ? nested.children[0].children[0]
        : null;
    expect(deeper?.type === "todo" && deeper.checked).toBe(true);
    const para = blocks[1];
    expect(para?.type === "paragraph" && para.text).toEqual([
      { type: "text", text: "First paragraph\nstill first" },
    ]);
    expect(blocks.every((b) => b.id.startsWith("new"))).toBe(true);
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
