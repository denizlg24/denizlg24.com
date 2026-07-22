import { describe, expect, it } from "bun:test";
import {
  advanceGhostSuggestion,
  canRequestLatexCompletion,
  DEFAULT_LATEX_COMPLETION_DELAY_MS,
} from "./inline-completion";

it("waits for three seconds of typing inactivity by default", () => {
  expect(DEFAULT_LATEX_COMPLETION_DELAY_MS).toBe(3_000);
});

describe("canRequestLatexCompletion", () => {
  it("skips comments, math, commands, citations, and bibliography files", () => {
    expect(canRequestLatexCompletion("Text % comment", 14, "main.tex")).toBe(
      false,
    );
    expect(canRequestLatexCompletion("Value $x", 8, "main.tex")).toBe(false);
    expect(canRequestLatexCompletion("\\sect", 5, "main.tex")).toBe(false);
    expect(canRequestLatexCompletion("\\cite{key", 9, "main.tex")).toBe(false);
    expect(canRequestLatexCompletion("Title", 5, "refs.bib")).toBe(false);
  });

  it("allows prose after a word or punctuation", () => {
    expect(canRequestLatexCompletion("A useful result", 15, "main.tex")).toBe(
      true,
    );
    expect(canRequestLatexCompletion("A useful result.", 16, "main.tex")).toBe(
      true,
    );
    expect(canRequestLatexCompletion("A useful result ", 16, "main.tex")).toBe(
      true,
    );
    expect(canRequestLatexCompletion("   ", 3, "main.tex")).toBe(false);
  });
});

describe("advanceGhostSuggestion", () => {
  it("keeps the untyped suffix when entered text matches", () => {
    expect(
      advanceGhostSuggestion(
        { from: 10, text: " therefore" },
        { from: 10, to: 10, inserted: " th" },
      ),
    ).toEqual({ from: 13, text: "erefore" });
  });

  it("dismisses a suggestion for divergent or out-of-position edits", () => {
    const suggestion = { from: 10, text: " therefore" };
    expect(
      advanceGhostSuggestion(suggestion, {
        from: 10,
        to: 10,
        inserted: " x",
      }),
    ).toBeNull();
    expect(
      advanceGhostSuggestion(suggestion, {
        from: 9,
        to: 9,
        inserted: " ",
      }),
    ).toBeNull();
  });

  it("clears after the entire suggestion is typed", () => {
    expect(
      advanceGhostSuggestion(
        { from: 10, text: " result" },
        { from: 10, to: 10, inserted: " result" },
      ),
    ).toBeNull();
  });
});
