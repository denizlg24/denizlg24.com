import { describe, expect, test } from "bun:test";
import { SURFACE_CODE_MAX, surfaceSourceRequestSchema } from "@repo/schemas";
import {
  editSurfaceSource,
  readSurfaceSource,
  searchSurfaceSource,
} from "./surface-source";

const source = {
  head: "",
  html: "<h1>Hello</h1>",
  css: "",
  js: "const one = 1;\nconst two = 2;\n",
};

function request(value: unknown) {
  return surfaceSourceRequestSchema.parse(value);
}

describe("bounded surface source", () => {
  test("line ranges and long lines paginate without losing characters", () => {
    const input = request({
      action: "source_read",
      field: "js",
      startLine: 2,
      endLine: 2,
      maxChars: 5,
    });
    if (input.action !== "source_read") throw new Error("wrong action");
    const first = readSurfaceSource(source, input);
    expect(first).toMatchObject({
      text: "const",
      nextOffset: 5,
      totalLines: 3,
    });
    let text = first.text;
    let offset = first.nextOffset;
    while (offset !== null) {
      const page = readSurfaceSource(source, { ...input, offset });
      text += page.text;
      offset = page.nextOffset;
    }
    expect(text).toBe("const two = 2;");
    const huge = readSurfaceSource(
      { ...source, js: "a".repeat(100_000) },
      { ...input, startLine: 1, endLine: 1, offset: 0, maxChars: 12_000 },
    );
    expect(huge.text.length).toBe(12_000);
    expect(huge.nextOffset).toBe(12_000);
    expect(
      readSurfaceSource(source, { ...input, startLine: 20, endLine: 21 }),
    ).toMatchObject({ text: "", nextOffset: null });
  });

  test("literal search reports accurate positions and continuation across fields", () => {
    const input = request({
      action: "source_search",
      query: "const",
      limit: 1,
    });
    if (input.action !== "source_search") throw new Error("wrong action");
    const first = searchSurfaceSource(source, input);
    expect(first).toMatchObject({
      matches: [{ field: "js", offset: 0, line: 1, column: 1 }],
      nextOffset: 1,
    });
    expect(searchSurfaceSource(source, { ...input, offset: 1 })).toMatchObject({
      matches: [{ field: "js", offset: 15, line: 2, column: 1 }],
      nextOffset: null,
    });
    expect(
      searchSurfaceSource(source, { ...input, query: ".*" }).matches,
    ).toEqual([]);
    const repeated = searchSurfaceSource(
      { ...source, html: "x".repeat(50_000), js: "x" },
      { ...input, query: "x", limit: 40 },
    );
    expect(repeated.matches).toHaveLength(40);
    expect(repeated.matches.every((match) => match.snippet.length <= 240)).toBe(
      true,
    );
    expect(
      searchSurfaceSource(
        { ...source, html: "x", js: "x" },
        { ...input, query: "x", offset: 1 },
      ).matches[0]?.field,
    ).toBe("js");
  });

  test("edits are sequential, literal and leave original source intact on any failure", () => {
    const input = request({
      action: "source_edit",
      baseRev: 1,
      edits: [
        { field: "js", oldText: "one = 1", newText: "one = 3" },
        { field: "js", oldText: "one = 3", newText: "one = '$&'" },
        { field: "html", oldText: "Hello", newText: "Hi" },
      ],
    });
    if (input.action !== "source_edit") throw new Error("wrong action");
    expect(editSurfaceSource(source, input)).toEqual({
      js: "const one = '$&';\nconst two = 2;\n",
      html: "<h1>Hi</h1>",
    });
    expect(() =>
      editSurfaceSource(source, {
        ...input,
        edits: [
          ...input.edits,
          { field: "css", oldText: "missing", newText: "" },
        ],
      }),
    ).toThrow("exactly once");
    expect(source.js).toBe("const one = 1;\nconst two = 2;\n");
    expect(() =>
      editSurfaceSource(source, {
        ...input,
        edits: [{ field: "js", oldText: "const", newText: "let" }],
      }),
    ).toThrow("exactly once");
    expect(() =>
      editSurfaceSource(
        { ...source, js: "aaa" },
        { ...input, edits: [{ field: "js", oldText: "aa", newText: "b" }] },
      ),
    ).toThrow("exactly once");
    expect(() =>
      editSurfaceSource(source, {
        ...input,
        edits: [
          {
            field: "js",
            oldText: "one",
            newText: "x".repeat(SURFACE_CODE_MAX),
          },
        ],
      }),
    ).toThrow("limited");
  });

  test("schemas require revisions and unique HTTPS imports, and bound reads", () => {
    for (const input of [
      {
        action: "source_edit",
        edits: [{ field: "js", oldText: "a", newText: "b" }],
      },
      { action: "source_read", field: "js", startLine: 5, endLine: 2 },
      { action: "source_read", field: "js", maxChars: 24_001 },
      {
        action: "source_import",
        baseRev: 1,
        sources: [{ field: "js", sourceUrl: "http://example.com/a.js" }],
      },
      {
        action: "source_import",
        baseRev: 1,
        sources: [
          { field: "js", sourceUrl: "https://example.com/a.js" },
          { field: "js", sourceUrl: "https://example.com/b.js" },
        ],
      },
    ])
      expect(surfaceSourceRequestSchema.safeParse(input).success).toBe(false);
  });
});
