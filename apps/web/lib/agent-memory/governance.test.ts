import { describe, expect, test } from "bun:test";
import { Types } from "mongoose";
import { candidateToRevisionState } from "./governance";

describe("agent memory governance planning", () => {
  test("preserves provenance and temporal state when promoting a candidate", () => {
    const evidenceId = "9fa3e791-b155-4719-bda8-f6542ea421f3";
    const state = candidateToRevisionState({
      statement: "The user is temporarily living in Lisbon.",
      memoryType: "semantic",
      explicitness: "explicit",
      confidence: 0.96,
      importance: 0.7,
      trust: "high",
      sensitivity: "personal",
      temporal: {
        validFrom: "2026-07-01T00:00:00.000Z",
        validUntil: "2026-10-01T00:00:00.000Z",
        precision: "range",
      },
      entityRefs: [],
      evidenceIds: [evidenceId],
      conflictingMemoryIds: [],
    });

    expect(state.status).toBe("active");
    expect(state.evidenceIds).toEqual([evidenceId]);
    expect(state.temporal.precision).toBe("range");
  });

  test("records the superseded memory without erasing it", () => {
    const superseded = new Types.ObjectId();
    const state = candidateToRevisionState(
      {
        statement: "The user's current city is Lisbon.",
        memoryType: "semantic",
        explicitness: "explicit",
        confidence: 0.99,
        importance: 0.8,
        trust: "highest",
        sensitivity: "personal",
        temporal: { precision: "exact" },
        entityRefs: [],
        evidenceIds: ["9fa3e791-b155-4719-bda8-f6542ea421f3"],
        conflictingMemoryIds: [superseded],
      },
      superseded,
    );

    expect(state.supersedesMemoryId).toEqual(superseded);
    expect(state.contradictionIds).toEqual([superseded]);
  });
});
