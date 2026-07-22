import { describe, expect, test } from "bun:test";
import { mapLatexProse } from "@repo/latex-editor/context";
import { scalarIndexToUtf16 } from "./grammar";

describe("LaTeX grammar source offsets", () => {
  test("converts Harper scalar offsets to CodeMirror UTF-16 offsets", () => {
    expect(scalarIndexToUtf16("A😀 typo", 2)).toBe(3);
    expect(scalarIndexToUtf16("A😀 typo", 7)).toBe(8);
  });

  test("preserves offsets while masking commands, citations, math and comments", () => {
    const source =
      "\\textbf{This are prose} \\cite{hidden} $x = 1$ % ignore this\nMore prose.";
    const mapped = mapLatexProse(source);
    expect(mapped.masked.length).toBe(source.length);
    expect(
      mapped.masked.slice(source.indexOf("This"), source.indexOf("prose") + 5),
    ).toBe("This are prose");
    expect(mapped.masked).not.toContain("hidden");
    expect(mapped.masked).not.toContain("x = 1");
    expect(mapped.masked).not.toContain("ignore this");
  });
});
