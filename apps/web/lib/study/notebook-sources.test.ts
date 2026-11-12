import { describe, expect, test } from "bun:test";
import {
  effectiveNotebookSources,
  effectiveSourceKeys,
} from "./notebook-sources";

const id = (n: number) => n.toString(16).padStart(24, "0");

describe("effective notebook sources", () => {
  const inputs = {
    courseNoteIds: [id(1), id(2)],
    sources: [
      { kind: "document" as const, id: id(3) },
      { kind: "note" as const, id: id(2) },
      { kind: "voice-note" as const, id: id(4) },
    ],
    excluded: [`note:${id(1)}`, `document:${id(99)}`],
  };

  test("unions course notes with explicit sources, minus excluded", () => {
    expect(effectiveSourceKeys(inputs)).toEqual([
      `note:${id(2)}`,
      `document:${id(3)}`,
      `voice-note:${id(4)}`,
    ]);
  });

  test("includeExcluded brings the excluded back", () => {
    expect(effectiveSourceKeys(inputs, true)).toContain(`note:${id(1)}`);
  });

  test("a course note also added explicitly stays course-owned, once", () => {
    const all = effectiveNotebookSources(inputs);
    const twice = all.filter((s) => s.id === id(2));
    expect(twice).toHaveLength(1);
    expect(twice[0]?.origin).toBe("course");
  });

  test("flags excluded entries and ignores exclusions of unknown sources", () => {
    const all = effectiveNotebookSources(inputs);
    expect(all.find((s) => s.id === id(1))?.excluded).toBe(true);
    expect(all.some((s) => s.sourceKey === `document:${id(99)}`)).toBe(false);
  });

  test("a notebook with nothing resolves to nothing", () => {
    expect(
      effectiveSourceKeys({ courseNoteIds: [], sources: [], excluded: [] }),
    ).toEqual([]);
  });
});
