import { describe, expect, test } from "bun:test";
import { type DraftRef, type ExistingChunkRef, planChunkDiff } from "./diff";

const MODEL = "m";

function existing(
  ordinal: number,
  body: string,
  options: { header?: string; model?: string; legacy?: boolean } = {},
): ExistingChunkRef {
  return {
    id: `id${ordinal}`,
    ordinal,
    contentHash: `${options.header ?? "h"}|${body}`,
    ...(options.legacy ? {} : { bodyHash: body }),
    model: options.model ?? MODEL,
    chunkerVersion: 1,
  };
}

function draft(ordinal: number, body: string, header = "h"): DraftRef {
  return { ordinal, contentHash: `${header}|${body}`, bodyHash: body };
}

function plan(
  existingChunks: ExistingChunkRef[],
  drafts: DraftRef[],
  reusable: string[] = [],
) {
  return planChunkDiff({
    existing: existingChunks,
    drafts,
    model: MODEL,
    reusableHashes: new Set(reusable),
  });
}

describe("planChunkDiff", () => {
  test("unchanged chunks keep their id and vector", () => {
    const result = plan(
      [existing(0, "a"), existing(1, "b")],
      [draft(0, "a"), draft(1, "b")],
    );
    expect(
      result.entries.map((entry) => [entry.existingId, entry.action]),
    ).toEqual([
      ["id0", "keep"],
      ["id1", "keep"],
    ]);
    expect(result.deleteIds).toEqual([]);
  });

  test("an edited chunk re-embeds in place, keeping its id", () => {
    const result = plan(
      [existing(0, "a"), existing(1, "b")],
      [draft(0, "a"), draft(1, "b2")],
    );
    expect(result.entries[1]).toMatchObject({
      existingId: "id1",
      action: "embed",
    });
  });

  test("inserting a paragraph at the top keeps later chunks' ids", () => {
    const result = plan(
      [existing(0, "a"), existing(1, "b")],
      [draft(0, "new"), draft(1, "a"), draft(2, "b")],
    );
    expect(
      result.entries.map((entry) => [
        entry.ordinal,
        entry.existingId,
        entry.action,
      ]),
    ).toEqual([
      [0, null, "embed"],
      [1, "id0", "keep"],
      [2, "id1", "keep"],
    ]);
    expect(result.deleteIds).toEqual([]);
  });

  test("an edit that shifts ordinals does not hand a chunk to the wrong passage", () => {
    const result = plan(
      [existing(0, "a"), existing(1, "b"), existing(2, "c")],
      [draft(0, "b"), draft(1, "c")],
    );
    expect(result.entries.map((entry) => entry.existingId)).toEqual([
      "id1",
      "id2",
    ]);
    expect(result.deleteIds).toEqual(["id0"]);
  });

  test("renaming the note keeps ids and body hashes but re-embeds", () => {
    const result = plan(
      [existing(0, "a"), existing(1, "b")],
      [draft(0, "a", "renamed"), draft(1, "b", "renamed")],
    );
    expect(result.entries.map((entry) => entry.existingId)).toEqual([
      "id0",
      "id1",
    ]);
    expect(result.entries.map((entry) => entry.bodyHash)).toEqual(["a", "b"]);
    expect(result.entries.map((entry) => entry.contentHash)).toEqual([
      "renamed|a",
      "renamed|b",
    ]);
    expect(result.entries.map((entry) => entry.action)).toEqual([
      "embed",
      "embed",
    ]);
  });

  test("a renamed chunk reuses a vector already known for the new text", () => {
    const result = plan(
      [existing(0, "a")],
      [draft(0, "a", "renamed")],
      ["renamed|a"],
    );
    expect(result.entries[0]).toMatchObject({
      existingId: "id0",
      action: "reuse",
    });
  });

  test("chunks stored without a body hash still match by content hash", () => {
    const result = plan(
      [existing(0, "a", { legacy: true }), existing(1, "b", { legacy: true })],
      [draft(0, "new"), draft(1, "a"), draft(2, "b")],
    );
    expect(result.entries.map((entry) => entry.existingId)).toEqual([
      null,
      "id0",
      "id1",
    ]);
    expect(result.entries[1]?.action).toBe("keep");
  });

  test("duplicate passages each claim their own chunk", () => {
    const result = plan(
      [existing(0, "x"), existing(1, "x")],
      [draft(0, "x"), draft(1, "x"), draft(2, "x")],
    );
    expect(result.entries.map((entry) => entry.existingId)).toEqual([
      "id0",
      "id1",
      null,
    ]);
  });

  test("chunks no draft claims are deleted", () => {
    const result = plan(
      [existing(0, "a"), existing(1, "b"), existing(2, "c")],
      [draft(0, "a")],
    );
    expect(result.deleteIds).toEqual(["id1", "id2"]);
  });

  test("a different embedding model forces a fresh vector for identical text", () => {
    const result = plan([existing(0, "a", { model: "old" })], [draft(0, "a")]);
    expect(result.entries[0]).toMatchObject({
      existingId: "id0",
      action: "embed",
    });
  });

  test("an empty source plans nothing and deletes everything", () => {
    const result = plan([existing(0, "a")], []);
    expect(result.entries).toEqual([]);
    expect(result.deleteIds).toEqual(["id0"]);
  });
});
