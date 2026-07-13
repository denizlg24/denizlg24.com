import { describe, expect, test } from "bun:test";
import {
  agentEvidenceEventSchema,
  agentMemoryDecisionSchema,
  agentTemporalSchema,
} from "./agent-memory";

const evidence = {
  eventId: "9fa3e791-b155-4719-bda8-f6542ea421f3",
  idempotencyKey: "conversation:123:message:1",
  sourceType: "conversation",
  sourceRef: { entityType: "conversation", entityId: "123", revision: "1" },
  contentHash: "a".repeat(64),
  snapshot: "I prefer concise answers.",
  occurredAt: "2026-07-13T10:00:00.000Z",
  observedAt: "2026-07-13T10:00:01.000Z",
  actor: "user",
  trust: "high",
  sensitivity: "personal",
  memoryEligible: true,
  provenance: { messageIndex: 1 },
} as const;

describe("agent memory schemas", () => {
  test("accepts bounded evidence with provenance", () => {
    expect(agentEvidenceEventSchema.parse(evidence).eventId).toBe(
      evidence.eventId,
    );
  });

  test("rejects evidence snapshots over the storage limit", () => {
    expect(
      agentEvidenceEventSchema.safeParse({
        ...evidence,
        snapshot: "x".repeat(8_193),
      }).success,
    ).toBe(false);
  });

  test("rejects inverted temporal ranges", () => {
    expect(
      agentTemporalSchema.safeParse({
        validFrom: "2026-07-14T00:00:00.000Z",
        validUntil: "2026-07-13T00:00:00.000Z",
        precision: "range",
      }).success,
    ).toBe(false);
  });

  test("requires a reason for governance decisions", () => {
    expect(
      agentMemoryDecisionSchema.safeParse({ action: "dismiss" }).success,
    ).toBe(false);
  });
});
