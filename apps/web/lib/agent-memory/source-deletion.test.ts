import { describe, expect, test } from "bun:test";
import { buildSourceEvidenceQuery } from "./source-deletion";

describe("agent memory source deletion", () => {
  test("targets every revision when the canonical entity is deleted", () => {
    expect(
      buildSourceEvidenceQuery({ entityType: "note", entityId: "note-1" }),
    ).toEqual({
      "sourceRef.entityType": "note",
      "sourceRef.entityId": "note-1",
      redactedAt: { $exists: false },
    });
  });

  test("can redact one exact source revision", () => {
    expect(
      buildSourceEvidenceQuery({
        entityType: "note",
        entityId: "note-1",
        revision: "revision-2",
      }),
    ).toMatchObject({ "sourceRef.revision": "revision-2" });
  });

  test("rejects an incomplete canonical source reference", () => {
    expect(() =>
      buildSourceEvidenceQuery({ entityType: "note", entityId: " " }),
    ).toThrow("requires an entity type and entity id");
  });
});
