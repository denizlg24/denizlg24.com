import { describe, expect, test } from "bun:test";
import {
  articleBody,
  articleFromRecipe,
  fromDraftBlocks,
  toDraftBlocks,
} from "./article-draft";

describe("article drafts", () => {
  test("round-trips blocks through editable text", () => {
    const blocks = [
      {
        type: "paragraph" as const,
        content: [{ text: "Toast " }, { text: "slowly", bold: true }],
      },
      { type: "heading" as const, text: "For the sauce" },
      {
        type: "list" as const,
        ordered: true,
        items: [[{ text: "Oats" }], [{ text: "Milk", italic: true }]],
      },
      { type: "image" as const, imageKey: "k", caption: "Done" },
    ];
    expect(fromDraftBlocks(toDraftBlocks(blocks))).toEqual(blocks);
  });

  test("strips typed bullets from list lines and drops empty ones", () => {
    expect(
      fromDraftBlocks([
        { key: "a", type: "list", ordered: false, text: "- oats\n\n2. milk" },
      ]),
    ).toEqual([
      {
        type: "list",
        ordered: false,
        items: [[{ text: "oats" }], [{ text: "milk" }]],
      },
    ]);
  });

  test("an untouched new recipe sends an empty article", () => {
    expect(articleBody(articleFromRecipe(undefined))).toEqual({
      description: null,
      coverImageKey: null,
      story: [],
      steps: [],
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      isPublished: false,
    });
  });
});
