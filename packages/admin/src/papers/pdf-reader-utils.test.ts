import { describe, expect, it } from "bun:test";
import {
  findPdfMatches,
  flattenPdfOutline,
  highlightPdfText,
} from "./pdf-reader-utils";

describe("PDF reader navigation", () => {
  it("flattens nested bookmarks without losing their depth", () => {
    expect(
      flattenPdfOutline([
        {
          title: "One",
          dest: "one",
          items: [{ title: "Child", dest: null, items: [] }],
        },
      ]),
    ).toEqual([
      { title: "One", depth: 0, destination: "one" },
      { title: "Child", depth: 1, destination: null },
    ]);
  });

  it("indexes every case-insensitive match on a page", () => {
    const matches = findPdfMatches("Alpha beta ALPHA", "alpha", 3);
    expect(matches.map((match) => [match.page, match.index])).toEqual([
      [3, 0],
      [3, 11],
    ]);
  });

  it("highlights safely without trusting PDF text as HTML", () => {
    expect(highlightPdfText("<script>Alpha</script>", "alpha")).toContain(
      "&lt;script&gt;<mark",
    );
  });
});
