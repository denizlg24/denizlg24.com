import { describe, expect, test } from "bun:test";
import { matchFor, searchTerms } from "./search";

const segments = [
  { text: "Today we look at running time.", startSecond: 0 },
  { text: "   ", startSecond: 300 },
  { text: "The worst case is quadratic.", startSecond: 600 },
];

function note(title: string, withSegments = true) {
  return {
    title,
    transcription: {
      text: segments
        .map((segment) => segment.text.trim())
        .filter(Boolean)
        .join(" "),
      segments: withSegments ? segments : undefined,
    },
  };
}

describe("searchTerms", () => {
  test("lowercases, splits and deduplicates", () => {
    expect(searchTerms("  Worst  CASE worst ")).toEqual(["worst", "case"]);
  });

  test("is empty without a query", () => {
    expect(searchTerms(undefined)).toEqual([]);
  });
});

describe("matchFor", () => {
  test("maps a transcript hit to the piece it was spoken in, skipping silent pieces", () => {
    const match = matchFor(note("Lecture"), ["quadratic"]);
    expect(match?.field).toBe("transcript");
    expect(match?.startSecond).toBe(600);
    expect(match?.snippet).toContain("quadratic");
  });

  test("uses the earliest term in the transcript", () => {
    expect(matchFor(note("Lecture"), ["worst", "running"])?.startSecond).toBe(
      0,
    );
  });

  test("marks a cut snippet with ellipses", () => {
    const long = {
      title: "Long",
      transcription: { text: `${"a ".repeat(200)}needle${" b".repeat(200)}` },
    };
    const snippet = matchFor(long, ["needle"])?.snippet ?? "";
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  test("has no timestamp for a transcript without segments", () => {
    const match = matchFor(note("Lecture", false), ["quadratic"]);
    expect(match?.field).toBe("transcript");
    expect(match?.startSecond).toBeUndefined();
  });

  test("falls back to the title, then tags", () => {
    expect(matchFor(note("Algorithms"), ["algorithms"])).toEqual({
      field: "title",
    });
    expect(matchFor(note("Lecture"), ["exam"])).toEqual({ field: "tags" });
  });

  test("returns nothing without terms", () => {
    expect(matchFor(note("Lecture"), [])).toBeUndefined();
  });
});
