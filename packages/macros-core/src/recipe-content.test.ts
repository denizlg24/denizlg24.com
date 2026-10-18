import { describe, expect, test } from "bun:test";
import type { MacrosRecipeInline } from "@repo/schemas/macros";
import {
  inlinesToMarkdown,
  markdownToInlines,
  normalizeBlocks,
  normalizeInlines,
  readingMinutes,
  recipeImageKeys,
} from "./recipe-content";

describe("markdown round trip", () => {
  const cases: MacrosRecipeInline[][] = [
    [{ text: "plain text" }],
    [{ text: "Toast " }, { text: "slowly", bold: true }, { text: "." }],
    [{ text: "a " }, { text: "loose", italic: true }, { text: " crumb" }],
    [{ text: "both", bold: true, italic: true }],
    [
      { text: "see " },
      { text: "the source", href: "https://example.com/a_b?x=1" },
    ],
    [{ text: "bold link", bold: true, href: "https://example.com" }],
    [{ text: "literal **stars**, _under_scores_ and [brackets]" }],
  ];
  for (const content of cases) {
    test(JSON.stringify(content), () => {
      expect(markdownToInlines(inlinesToMarkdown(content))).toEqual(content);
    });
  }

  test("keeps snake_case and 2_000 literal", () => {
    expect(markdownToInlines("snake_case and 2_000")).toEqual([
      { text: "snake_case and 2_000" },
    ]);
  });

  test("never turns a script url into a link", () => {
    expect(markdownToInlines("[x](javascript:alert(1))")).toEqual([
      { text: "[x](javascript:alert(1))" },
    ]);
  });

  test("leaves unmatched markers alone", () => {
    expect(markdownToInlines("**open and _half")).toEqual([
      { text: "**open and _half" },
    ]);
  });
});

describe("normalize", () => {
  test("merges runs with the same marks and trims the edges", () => {
    expect(
      normalizeInlines([
        { text: "  a" },
        { text: "b", bold: false },
        { text: "" },
        { text: "c ", bold: true },
      ]),
    ).toEqual([{ text: "ab" }, { text: "c", bold: true }]);
  });

  test("drops empty blocks and the response-only image url", () => {
    expect(
      normalizeBlocks([
        { type: "paragraph", content: [{ text: " " }] },
        { type: "heading", text: "  " },
        { type: "list", ordered: false, items: [[], [{ text: "x" }]] },
        { type: "image", imageKey: "k", imageUrl: "/x", caption: " " },
      ]),
    ).toEqual([
      { type: "list", ordered: false, items: [[{ text: "x" }]] },
      { type: "image", imageKey: "k" },
    ]);
  });
});

test("collects every image key once", () => {
  expect(
    recipeImageKeys({
      coverImageKey: "a",
      story: [{ type: "image", imageKey: "b" }],
      steps: [
        {
          title: "",
          blocks: [
            { type: "image", imageKey: "a" },
            { type: "image", imageKey: "c" },
          ],
        },
      ],
    }),
  ).toEqual(["a", "b", "c"]);
});

test("reading time never reads zero", () => {
  expect(readingMinutes({})).toBe(1);
});
