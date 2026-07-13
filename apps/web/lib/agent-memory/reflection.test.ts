import { describe, expect, test } from "bun:test";
import { Types } from "mongoose";
import type { IAgentMemory } from "@/models/AgentMemory";
import { projectChangedMemories } from "./reflection";

function memory(overrides: Partial<IAgentMemory> = {}): IAgentMemory {
  return {
    _id: new Types.ObjectId("507f1f77bcf86cd799439011"),
    statement: "Deniz is studying Calculus II.",
    memoryType: "semantic",
    status: "active",
    explicitness: "explicit",
    confidence: 0.95,
    importance: 0.8,
    trust: "high",
    sensitivity: "personal",
    temporal: { precision: "unknown" },
    entityRefs: [{ entityType: "course", entityId: "course-calculus-ii" }],
    evidenceIds: ["7ef113ee-c6d7-4b2d-b79f-b676eb2eb7eb"],
    contradictionIds: [],
    pinned: false,
    revision: 1,
    updatedAt: new Date("2026-07-13T12:00:00.000Z"),
    ...overrides,
  } as IAgentMemory;
}

describe("Gate E incremental user-model projection", () => {
  test("places changed memories into the relevant section idempotently", () => {
    const first = projectChangedMemories(undefined, [memory()]);
    const second = projectChangedMemories(first, [memory()]);

    expect(first["education-career-skills"]).toHaveLength(1);
    expect(second["education-career-skills"]).toHaveLength(1);
    expect(second["education-career-skills"]?.[0]?.evidenceIds).toEqual([
      "7ef113ee-c6d7-4b2d-b79f-b676eb2eb7eb",
    ]);
  });

  test("removes archived memories without changing unrelated chunks", () => {
    const active = memory();
    const first = projectChangedMemories(undefined, [active]);
    const archived = memory({ status: "archived", revision: 2 });
    const second = projectChangedMemories(first, [archived]);

    expect(second["education-career-skills"]).toEqual([]);
  });
});
