import { describe, expect, test } from "bun:test";
import type { KnowledgeSourceKey } from "@repo/schemas";
import { unindexedSources } from "./reconcile-plan";

const a = "note:aaaaaaaaaaaaaaaaaaaaaaaa" as KnowledgeSourceKey;
const b = "note:bbbbbbbbbbbbbbbbbbbbbbbb" as KnowledgeSourceKey;
const c = "voice-note:cccccccccccccccccccccccc" as KnowledgeSourceKey;

describe("unindexedSources", () => {
  test("every source is lost when the state collection is empty", () => {
    expect(unindexedSources([a, b, c], [], new Map())).toEqual([a, b, c]);
  });

  test("an embedded row whose chunks are gone is lost", () => {
    const lost = unindexedSources(
      [a, b],
      [
        { sourceKey: a, state: "embedded", chunkCount: 3 },
        { sourceKey: b, state: "embedded", chunkCount: 2 },
      ],
      new Map([[b, 2]]),
    );
    expect(lost).toEqual([a]);
  });

  test("pending, failed and empty rows are left to their own lifecycle", () => {
    const lost = unindexedSources(
      [a, b, c],
      [
        { sourceKey: a, state: "pending", chunkCount: 0 },
        { sourceKey: b, state: "failed", chunkCount: 0 },
        { sourceKey: c, state: "empty", chunkCount: 0 },
      ],
      new Map(),
    );
    expect(lost).toEqual([]);
  });

  test("an embedded row that wrote no chunks is not lost", () => {
    expect(
      unindexedSources(
        [a],
        [{ sourceKey: a, state: "embedded", chunkCount: 0 }],
        new Map(),
      ),
    ).toEqual([]);
  });
});
